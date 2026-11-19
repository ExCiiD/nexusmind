#!/usr/bin/env node
/**
 * One-off script: registers the bot's global slash commands with Discord.
 * Run this once after creating the bot, and again whenever a command's name
 * or description changes here. The Worker routes on the command names
 * (src/index.ts), so a new command needs a handler there too.
 *
 * Usage (from this folder):
 *   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... node scripts/register-commands.mjs
 *
 * Global commands can take up to an hour to show up in Discord the first
 * time; edits to an existing command propagate faster.
 */
const STRING = 3
const SUB_COMMAND = 1
/** Discord "Manage Server" bit (1 << 5), as the decimal string the API expects. */
const MANAGE_GUILD = String(1 << 5)

const COMMANDS = [
  {
    name: 'link-team',
    description: 'Link this Discord server to an Ascend team (run the code generated in the app)',
    options: [{ type: STRING, name: 'code', description: 'Code from Ascend (Account page)', required: true }],
    // S19-03: hidden from regular members by default (server admins can change it).
    default_member_permissions: MANAGE_GUILD,
  },
  {
    name: 'link-me',
    description: 'Link your Discord account to your Ascend account (run the code generated in the app)',
    options: [{ type: STRING, name: 'code', description: 'Code from Ascend (Account page)', required: true }],
  },
  // S19-03: hidden from regular members by default. The handler checks
  // again (Manage Server, or the group's staff), since admins can widen this.
  { name: 'set-channel', description: 'Make THIS channel where the bot posts reminders and availability alerts', default_member_permissions: MANAGE_GUILD },
  { name: 'calendar', description: "Show the team's upcoming events and scrims (next 14 days)" },
  { name: 'scrims', description: 'Show upcoming scrims — date, Bo format, opponent OP.GG links, your roster roles' },
  { name: 'common-availability', description: 'Show windows this week where several linked teammates are all free' },
  {
    name: 'availability',
    description: 'Update your own availability',
    options: [
      {
        type: SUB_COMMAND,
        name: 'away',
        description: 'Mark yourself unavailable (and find a same-role sub if it clashes with a scrim)',
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
]

const token = process.env.DISCORD_BOT_TOKEN
const appId = process.env.DISCORD_APPLICATION_ID
if (!token || !appId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID in the environment first.')
  process.exit(1)
}

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(COMMANDS),
})
const body = await res.text()
if (!res.ok) {
  console.error(`Registration failed (${res.status}):`, body)
  process.exit(1)
}
console.log(`Registered ${COMMANDS.length} commands.`)
