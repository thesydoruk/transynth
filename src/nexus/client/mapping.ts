import type { NexusGame, NexusMod } from '../types';
import {
  asRecord,
  toNullableBoolean,
  toNullableNumber,
  toNullableString,
  toNumber,
  toString,
} from './coercion';

export const mapGame = (input: unknown): NexusGame => {
  const value = asRecord(input);

  return {
    id: toNumber(value['id']),
    name: toString(value['name']),
    domainName: toString(value['domainName']),
    genre: toNullableString(value['genre']),
    forumUrl: toNullableString(value['forumUrl']),
    modCount: toNullableNumber(value['modCount']),
    downloadCount: toNullableString(value['downloadCount']),
    uniqueDownloadCount: toNullableString(value['uniqueDownloadCount']),
  };
};

export const mapMod = (input: unknown): NexusMod => {
  const value = asRecord(input);

  const tags = Array.isArray(value['tags'])
    ? (value['tags'] as unknown[])
        .map((tag) => asRecord(tag)['name'])
        .filter((tagName): tagName is string => typeof tagName === 'string')
    : [];

  return {
    id: toNumber(value['id']),
    modId: toNumber(value['modId']),
    uid: toString(value['uid']),
    name: toString(value['name']),
    summary: toString(value['summary']),
    description: toString(value['description']),
    version: toString(value['version']),
    category: toString(value['category']),
    status: toString(value['status']),
    author: toNullableString(value['author']),
    createdAt: toString(value['createdAt']),
    updatedAt: toString(value['updatedAt']),
    downloads: toNumber(value['downloads']),
    endorsements: toNumber(value['endorsements']),
    adultContent: toNullableBoolean(value['adultContent']),
    pictureUrl: toNullableString(value['pictureUrl']),
    thumbnailUrl: toNullableString(value['thumbnailUrl']),
    gameId: toNumber(value['gameId']),
    game: mapGame(value['game']),
    uploader: value['uploader']
      ? {
          memberId: toNullableNumber(asRecord(value['uploader'])['memberId']),
          name: toString(asRecord(value['uploader'])['name']),
        }
      : null,
    tags,
  };
};
