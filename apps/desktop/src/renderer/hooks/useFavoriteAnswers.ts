/** Stores answer references locally without duplicating message content. */
/* 中文：在本机保存回答引用，收藏内容始终从原会话读取。 */
import { useState } from 'react';

/* 中文：收藏引用包含消息和会话标识，以及原记录所属命名空间。 */
export type FavoriteAnswer = { messageId: string; sessionId: string; namespaceKey: string };
const storageKey = 'fastgpt.workspace.favorite-answers.v1';

/* 中文：容错读取收藏引用，忽略格式无效或不完整的数据。 */
function readFavorites(): FavoriteAnswer[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value)
      ? value.filter(
          (item): item is FavoriteAnswer =>
            !!item &&
            typeof item.messageId === 'string' &&
            typeof item.sessionId === 'string' &&
            typeof item.namespaceKey === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/* 中文：切换收藏并持久化引用；写入失败时保留原状态并向界面报告错误。 */
export function useFavoriteAnswers(onError: (message: string) => void) {
  const [favorites, setFavorites] = useState<FavoriteAnswer[]>(readFavorites);
  const toggle = (reference: FavoriteAnswer) => {
    const next = favorites.some(
      (item) =>
        item.messageId === reference.messageId && item.namespaceKey === reference.namespaceKey,
    )
      ? favorites.filter(
          (item) =>
            item.messageId !== reference.messageId || item.namespaceKey !== reference.namespaceKey,
        )
      : [...favorites, reference];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setFavorites(next);
    } catch {
      onError('无法保存收藏，请检查本机存储是否可用。');
    }
  };
  return { favorites, toggle };
}
