/**
 * The slash commands exactly as Discord is told about them.
 *
 * Kept out of register-commands.mjs because that script prompts for a bot
 * token the moment it is imported, so nothing could ever read these
 * definitions without sitting at a password prompt. Having them here means a
 * test can check them against the maps the Worker resolves them with —
 * /lfg's game choices and GAME_ROLES / GAME_VOICE are two halves of one
 * contract, and Discord accepts a choice the Worker cannot answer without
 * complaint.
 *
 * Changing anything here needs `npm run register` to take effect. Discord
 * stores its own copy; editing this file alone changes nothing.
 */

const SUB_COMMAND = 1;
const STRING = 3;
const INTEGER = 4;
const USER = 6;

/** MANAGE_MESSAGES, bit 13 — the permission Mod has and Member does not. */
const MANAGE_MESSAGES = 1 << 13;

export const COMMANDS = [
  {
    name: 'lfg',
    description: 'Start a session and pull people in',
    options: [
      {
        name: 'game',
        description: 'What are you running?',
        type: STRING,
        required: true,
        // Every value here must exist in GAME_ROLES and GAME_VOICE. The
        // pairing is asserted in commands.test.mjs.
        choices: [
          { name: '2K', value: '2k' },
          { name: 'CoD', value: 'cod' },
          { name: 'Madden', value: 'madden' },
          { name: 'Fighting Games', value: 'fgc' },
        ],
      },
      {
        name: 'slots',
        description: 'How many people total (default 5)',
        type: INTEGER,
        required: false,
      },
    ],
  },
  { name: 'picks', description: 'Get your link to this week’s pick’em', options: [] },
  // Open to everyone: standings nobody can look at are half a competition.
  { name: 'leaderboard', description: 'Season standings so far', options: [] },
  {
    name: 'award',
    description: 'Give season points for something the pick’em cannot score',
    // Discord hides the command from anyone without Manage Messages, which
    // Mod has and Member does not. Gating it here rather than only in code
    // means the wrong people never see it in the picker — but the handler
    // checks the same bit anyway, because this can be overridden per server
    // in Integrations settings.
    default_member_permissions: String(MANAGE_MESSAGES),
    options: [
      { name: 'user', description: 'Who earned them', type: USER, required: true },
      {
        name: 'points',
        description: 'How many (negative to correct a mistake)',
        type: INTEGER,
        required: true,
      },
      {
        name: 'reason',
        description: 'What for — this shows on the leaderboard',
        type: STRING,
        required: true,
      },
    ],
  },
  {
    name: 'bracket',
    description: 'Run a tournament',
    // No default_member_permissions, unlike /award. Joining, viewing and
    // reporting your own set are for everybody, and Discord can only hide a
    // whole command, never one subcommand — so create, start, undo and cancel
    // check for Manage Messages in the handler instead. That means those four
    // stay visible to everyone in the picker and refuse when used, which is
    // the lesser of the two annoyances.
    options: [
      {
        type: SUB_COMMAND,
        name: 'create',
        description: 'Open sign-ups for a new tournament',
        options: [
          {
            name: 'name',
            description: 'What to call it — shows on every post and on the leaderboard',
            type: STRING,
            required: true,
          },
        ],
      },
      { type: SUB_COMMAND, name: 'join', description: 'Put your name in' },
      { type: SUB_COMMAND, name: 'leave', description: 'Take your name out before it starts' },
      { type: SUB_COMMAND, name: 'start', description: 'Draw the bracket and begin' },
      { type: SUB_COMMAND, name: 'view', description: 'Who plays who right now' },
      {
        type: SUB_COMMAND,
        name: 'report',
        description: 'Say who won your set',
        options: [
          {
            name: 'match',
            description: 'Which set — start typing a name',
            type: STRING,
            required: true,
            // The list of playable matches, resolved live. Entrant names are
            // stored at sign-up precisely so this can answer without going
            // back to Discord for them.
            autocomplete: true,
          },
          { name: 'winner', description: 'Who won it', type: USER, required: true },
        ],
      },
      { type: SUB_COMMAND, name: 'undo', description: 'Take back the last reported result' },
      { type: SUB_COMMAND, name: 'cancel', description: 'Call the whole thing off' },
    ],
  },
];

/** The subcommands of /bracket only a mod may run. */
export const BRACKET_MOD_ONLY = ['create', 'start', 'undo', 'cancel'];

/** The game values /lfg offers, in the order they appear in the picker. */
export function lfgGameChoices() {
  const lfg = COMMANDS.find((c) => c.name === 'lfg');
  const game = lfg?.options?.find((o) => o.name === 'game');
  return (game?.choices ?? []).map((c) => c.value);
}
