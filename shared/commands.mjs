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

const STRING = 3;
const INTEGER = 4;

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
];

/** The game values /lfg offers, in the order they appear in the picker. */
export function lfgGameChoices() {
  const lfg = COMMANDS.find((c) => c.name === 'lfg');
  const game = lfg?.options?.find((o) => o.name === 'game');
  return (game?.choices ?? []).map((c) => c.value);
}
