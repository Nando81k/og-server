/**
 * Discord's REST API over plain fetch. discord.js does not run on Workers —
 * it needs Node APIs that are not there — and this only makes a handful of
 * calls, so there is nothing to miss.
 */
const API = 'https://discord.com/api/v10';

export function createApi(token) {
  async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    call,
    roles: (guildId) => call('GET', `/guilds/${guildId}/roles`),
    channels: (guildId) => call('GET', `/guilds/${guildId}/channels`),
    members: (guildId, limit = 1000) =>
      call('GET', `/guilds/${guildId}/members?limit=${limit}`),
    addRole: (guildId, userId, roleId) =>
      call('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`),
    removeRole: (guildId, userId, roleId) =>
      call('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`),
  };
}
