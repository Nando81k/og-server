import * as djs from 'discord.js';
import {
  GAME_ROLES, TEMP_PREFIX, tempChannelName, isTempChannel,
  shouldDelete, isDueForPromotion, clampSlots,
} from './lib.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- discord.js v' + djs.version + ' symbols used by index.mjs ---');
for (const name of ['Client','Events','GatewayIntentBits','ChannelType','REST','Routes','SlashCommandBuilder','MessageFlags']) {
  check(`exports ${name}`, djs[name] !== undefined);
}
check('Events.ClientReady exists', typeof djs.Events.ClientReady === 'string');
check('Events.InteractionCreate exists', typeof djs.Events.InteractionCreate === 'string');
check('Events.VoiceStateUpdate exists', typeof djs.Events.VoiceStateUpdate === 'string');
check('ChannelType.GuildVoice exists', djs.ChannelType.GuildVoice !== undefined);
check('ChannelType.GuildCategory exists', djs.ChannelType.GuildCategory !== undefined);
check('GatewayIntentBits.GuildMembers exists', djs.GatewayIntentBits.GuildMembers !== undefined);
check('MessageFlags.Ephemeral exists', djs.MessageFlags.Ephemeral !== undefined);
check('Routes.applicationGuildCommands is a fn', typeof djs.Routes.applicationGuildCommands === 'function');

console.log('\n--- the /lfg command actually builds ---');
let json;
try {
  json = new djs.SlashCommandBuilder()
    .setName('lfg').setDescription('Start a session and pull people in')
    .addStringOption((o) => o.setName('game').setDescription('What are you running?').setRequired(true)
      .addChoices({name:'2K',value:'2k'},{name:'CoD',value:'cod'},{name:'Madden',value:'madden'},{name:'Fighting Games',value:'fgc'}))
    .addIntegerOption((o) => o.setName('slots').setDescription('How many people total (default 5)').setRequired(false))
    .toJSON();
  check('command serializes without throwing', true);
  check('has both options', json.options.length === 2);
  check('every choice maps to a known game', json.options[0].choices.every((c) => GAME_ROLES[c.value]));
} catch (e) {
  check('command serializes without throwing: ' + e.message, false);
}

console.log('\n--- naming ---');
check('2k -> LFG · 2K', tempChannelName('2k') === 'LFG · 2K');
check('fgc -> LFG · Fighting Games', tempChannelName('fgc') === 'LFG · Fighting Games');
check('unknown game throws', (() => { try { tempChannelName('halo'); return false; } catch { return true; } })());
check('recognises its own channels', isTempChannel(TEMP_PREFIX + '2K'));
check('leaves other voice channels alone', !isTempChannel('General Voice') && !isTempChannel('OG Voice'));
check('survives a non-string name', !isTempChannel(undefined));

console.log('\n--- cleanup ---');
const now = 1_000_000_000;
const grace = 5 * 60 * 1000;
check('occupied room is kept', !shouldDelete({memberCount:2, createdAt:now-grace*2, now, graceMs:grace}));
check('brand new empty room gets its grace period', !shouldDelete({memberCount:0, createdAt:now, now, graceMs:grace}));
check('empty room past grace is deleted', shouldDelete({memberCount:0, createdAt:now-grace-1, now, graceMs:grace}));
check('orphan from a restart is deleted', shouldDelete({memberCount:0, createdAt:0, now, graceMs:grace}));

console.log('\n--- promotion ---');
const day = 24*60*60*1000;
check('6 days is too soon', !isDueForPromotion({joinedAt: now-6*day, now, afterDays:7}));
check('7 days exactly is due', isDueForPromotion({joinedAt: now-7*day, now, afterDays:7}));
check('8 days is due', isDueForPromotion({joinedAt: now-8*day, now, afterDays:7}));
check('missing join date never promotes', !isDueForPromotion({joinedAt:null, now, afterDays:7}));

console.log('\n--- slots ---');
check('default holds', clampSlots(5) === 5);
check('1 is raised to 2', clampSlots(1) === 2);
check('0 does not mean unlimited', clampSlots(0) === 2);
check('over 99 is clamped', clampSlots(500) === 99);
check('garbage falls back to 5', clampSlots('abc') === 5);
check('rounds a decimal', clampSlots(4.6) === 5);

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
