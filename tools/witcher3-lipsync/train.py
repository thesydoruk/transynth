"""Train the Witcher 3 mouth model from a dataset `npm run w3:mimic-dataset` wrote.

    python tools/witcher3-lipsync/train.py <dataset dir> [--out <model.json>] [--epochs 30]

Learns, frame by frame, the 148 mimic poses CD PROJEKT RED animated for the
game's English lines from the log-mel audio around each frame. Every tenth
line is held out; the run reports how much of the face's movement the model
explains on those (R2, against predicting each pose's mean) and keeps the
epoch that explained the most.

Writes the model in the format `src/games/witcher3/mimic/model.ts` reads.
The weights are a measurement of the game's own data: keep them with the
install they came from, not in a repository.
"""

import argparse
import base64
import json
import time
from pathlib import Path

import numpy as np
import torch

MIN_VARIANCE = 1e-5


def b64(values: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(values, dtype="<f4").tobytes()).decode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--context", type=int, default=10)
    parser.add_argument("--hidden", type=int, nargs="+", default=[512, 256])
    parser.add_argument("--batch", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    index = json.loads((args.dataset / "index.json").read_text())
    mels, tracks, total = index["melBands"], index["trackCount"], index["totalFrames"]
    spectra = np.fromfile(args.dataset / "spectra.f32", dtype="<f4").reshape(total, mels)
    targets = np.fromfile(args.dataset / "targets.f32", dtype="<f4").reshape(total, tracks)

    # Window indices: frame f of a line sees frames f-context … f+context of the same line.
    lines = index["lines"]
    offsets = np.arange(-args.context, args.context + 1)
    frame_rows, is_val = [], []
    for i, line in enumerate(lines):
        start, n = line["offset"], line["frames"]
        local = np.clip(np.arange(n)[:, None] + offsets[None], 0, n - 1)
        frame_rows.append(start + local)
        is_val.append(np.full(n, i % 10 == 0))
    windows = np.concatenate(frame_rows)
    val = np.concatenate(is_val)
    frame = windows[:, args.context]

    train_frames = frame[~val]
    moving = np.nonzero(targets[train_frames].var(0) > MIN_VARIANCE)[0]
    held = np.median(targets[train_frames], axis=0)
    y_all = torch.from_numpy(targets[:, moving])
    x_spectra = torch.from_numpy(spectra)

    sample = x_spectra[torch.from_numpy(windows[~val][::50])].reshape(-1, mels * len(offsets))
    mean, std = sample.mean(0), sample.std(0) + 1e-5

    def batch_x(rows: np.ndarray) -> torch.Tensor:
        x = x_spectra[torch.from_numpy(windows[rows])].reshape(len(rows), -1)
        return (x - mean) / std

    torch.manual_seed(args.seed)
    sizes = [mels * len(offsets), *args.hidden, len(moving)]
    layers: list[torch.nn.Module] = []
    for i in range(len(sizes) - 1):
        layers.append(torch.nn.Linear(sizes[i], sizes[i + 1]))
        if i < len(sizes) - 2:
            layers += [torch.nn.GELU(approximate="tanh"), torch.nn.Dropout(0.1)]
    net = torch.nn.Sequential(*layers)
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)

    train_rows = np.nonzero(~val)[0]
    val_rows = np.nonzero(val)[0]
    y_val = y_all[torch.from_numpy(frame[val_rows])]
    val_var = ((y_val - y_val.mean(0)) ** 2).sum()
    print(f"{len(lines)} lines, {total} frames; {len(moving)} of {tracks} poses move; "
          f"{len(train_rows)} train / {len(val_rows)} held-out frames", flush=True)

    best, best_state, started = -1e9, None, time.time()
    for epoch in range(args.epochs):
        net.train()
        for chunk in np.array_split(np.random.permutation(train_rows), max(1, len(train_rows) // args.batch)):
            loss = ((net(batch_x(chunk)) - y_all[torch.from_numpy(frame[chunk])]) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
        sched.step()
        net.eval()
        with torch.no_grad():
            pred = torch.cat([net(batch_x(c)) for c in np.array_split(val_rows, max(1, len(val_rows) // 8192))])
        r2 = float(1 - ((pred - y_val) ** 2).sum() / val_var)
        top = int(torch.argmax(y_val.var(0)))
        corr = float(np.corrcoef(pred[:, top].numpy(), y_val[:, top].numpy())[0, 1])
        print(f"epoch {epoch + 1}: held-out R2 {r2:.3f}, widest-moving pose r={corr:.3f} "
              f"({time.time() - started:.0f}s)", flush=True)
        if r2 > best:
            best, best_state = r2, {k: v.clone() for k, v in net.state_dict().items()}

    net.load_state_dict(best_state)
    y_train = targets[train_frames][:, moving]
    linear = [m for m in net if isinstance(m, torch.nn.Linear)]
    model = {
        "format": "transynth-w3-mimic",
        "version": 1,
        "context": args.context,
        "melBands": mels,
        "inputMean": b64(mean.numpy()),
        "inputStd": b64(std.numpy()),
        "layers": [
            {
                "inputs": m.in_features,
                "outputs": m.out_features,
                "weights": b64(m.weight.detach().numpy()),
                "bias": b64(m.bias.detach().numpy()),
                "activation": "gelu" if i < len(linear) - 1 else "linear",
            }
            for i, m in enumerate(linear)
        ],
        "trackCount": tracks,
        "movingTracks": [int(t) for t in moving],
        "heldValues": [float(v) for v in held],
        "outputMin": b64(y_train.min(0)),
        "outputMax": b64(y_train.max(0)),
        "heldOutR2": best,
    }
    out = args.out or args.dataset / "mimic-model.json"
    out.write_text(json.dumps(model))
    print(f"best held-out R2 {best:.3f}; wrote {out}")


if __name__ == "__main__":
    main()
