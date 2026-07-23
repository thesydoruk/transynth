import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type {
  DialogConversation,
  DialogScene,
  DialogTopic,
  DialogTreeResult,
  SceneDialogLine,
} from '../types';

export const dialogsEndpoints = {
  topics: (modId: number) => req<DialogTopic[]>(`/api/dialogs/topics?modId=${modId}`),
  tree: (topicId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    req<DialogTreeResult>(
      `/api/dialogs/tree?topicId=${topicId}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
    ),
  scenes: (modId: number) => req<DialogScene[]>(`/api/dialogs/scenes?modId=${modId}`),
  conversations: (modId: number) =>
    req<DialogConversation[]>(`/api/dialogs/conversations?modId=${modId}`),
  sceneDialog: (sceneId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    req<SceneDialogLine[]>(
      `/api/dialogs/scene?sceneId=${sceneId}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
    ),
  conversationDialog: (
    modId: number,
    key: string,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) =>
    req<SceneDialogLine[]>(
      `/api/dialogs/conversation?modId=${modId}&key=${encodeURIComponent(key)}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
    ),
};
