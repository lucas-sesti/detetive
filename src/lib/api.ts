let _playerId: string | null = null;

export function getPlayerId(): string {
  if (_playerId) return _playerId;
  let id = localStorage.getItem('playerId');
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('playerId', id);
  }
  _playerId = id;
  return id;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-player-id': getPlayerId() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  createRoom: (nickname: string, avatar: string) =>
    post<{ ok: boolean; roomId: string }>('/api/create_room', { nickname, avatar }),

  joinRoom: (roomId: string, nickname: string, avatar: string) =>
    post<{ ok: boolean; roomId: string }>('/api/join_room', { roomId, nickname, avatar }),

  tick: (roomId: string): Promise<{ ok: boolean }> =>
    post('/api/tick', { roomId }),

  action: (roomId: string, type: string, payload?: unknown): Promise<{ ok: boolean }> =>
    post('/api/action', { roomId, type, payload }),

  clearMessages: (roomId: string, playerId: string): Promise<{ ok: boolean }> =>
    post('/api/clear_messages', { roomId, playerId }),
};
