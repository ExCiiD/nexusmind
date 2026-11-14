/**
 * Slash command definitions — the single source of truth for both
 * registration (scripts/register-commands.mjs) and the Worker's own
 * router (src/index.ts switches on `interaction.data.name`).
 */
const STRING = 3
const SUB_COMMAND = 1

export const COMMANDS = [
  {
    name: 'link-team',
    description: "Link this Discord server to an Ascend team (run the code generated in the app)",
    options: [{ type: STRING, name: 'code', description: 'Code from Ascend (Account page)', required: true }],
  },
  {
    name: 'link-me',
    description: 'Link your Discord account to your Ascend account (run the code generated in the app)',
    options: [{ type: STRING, name: 'code', description: 'Code from Ascend (Account page)', required: true }],
  },
  {
    name: 'set-channel',
    description: 'Make THIS channel where the bot posts reminders and availability alerts',
  },
  {
    name: 'calendar',
    description: "Show the team's upcoming events and scrims (next 14 days)",
  },
  {
    name: 'scrims',
    description: 'Show upcoming scrims — date, Bo format, opponent OP.GG links, your roster roles',
  },
  {
    name: 'common-availability',
    description: 'Show windows this week where several linked teammates are all free',
  },
  {
    name: 'availability',
    description: 'Update your own availability',
    options: [
      {
        type: SUB_COMMAND,
        name: 'away',
        description: "Mark yourself unavailable (and find a same-role sub if it clashes with a scrim)",
        options: [
          { type: STRING, name: 'date', description: 'YYYY-MM-DD', required: true },
          { type: STRING, name: 'end_date', description: 'YYYY-MM-DD, if more than one day', required: false },
          { type: STRING, name: 'note', description: 'Optional note', required: false },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'back',
        description: 'Clear an "away" marking for a date',
        options: [{ type: STRING, name: 'date', description: 'YYYY-MM-DD', required: true }],
      },
    ],
  },
] as const
