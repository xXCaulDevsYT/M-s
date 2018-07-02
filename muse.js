const { Client, Util } = require('discord.js');
const Discord = require("discord.js");
const config = {
	"TOKEN": process.env.TOKEN,
	"GOOGLE_API_KEY": process.env.GOOGLE_API_KEY,
	"DBL_API": process.env.DBL_API,
	"PREFIX": "m!"
}
const { TOKEN, GOOGLE_API_KEY, DBL_API } = config;
//const config = require("./config.json");
const YouTube = require('simple-youtube-api');
const ytdl = require('ytdl-core');
const fs = require(`fs`);
const DBL = require("dblapi.js");

const client = new Client({ disableEveryone: true });

const dbl = new DBL(`${DBL_API}`, client);

dbl.on('posted', () => {
	console.log('Server count posted!');
});

dbl.on('error', e => {
	console.log(`Oops! ${e}`);
});

client.commands = new Discord.Collection();

const youtube = new YouTube(GOOGLE_API_KEY);

const queue = new Map();



client.on('warn', console.warn);

client.on('error', console.error);

client.on(`ready`, (member) => {
	console.log(`${client.user.username} is online!`);
	client.user.setActivity(`${config.PREFIX}help || Playing on ${client.guilds.size} Servers`, "LISTENING")
});

client.on('disconnect', () => console.log('I just disconnected, making sure you know, I will reconnect now...'));

client.on('reconnecting', () => console.log('I am reconnecting now!'));

client.on('message', async msg => { // eslint-disable-line
	//custom prefix here

	let prefixes = JSON.parse(fs.readFileSync("./prefixes.json", "utf8"));

	if(!prefixes[msg.guild.id]){
		prefixes[msg.guild.id] = {
			prefixes: config.PREFIX
		};
	}

	let PREFIX = prefixes[msg.guild.id].prefixes;

	//custom prefix ends

	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;

	const args = msg.content.split(' ');
	const searchString = args.slice(1).join(' ');
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
	const serverQueue = queue.get(msg.guild.id);

	let command = msg.content.toLowerCase().split(' ')[0];
	command = command.slice(PREFIX.length)

	if (command === 'play') {
		const voiceChannel = msg.member.voiceChannel;
		if (!voiceChannel) return msg.channel.send('I\'m sorry but you need to be in a voice channel to play music!');
		const permissions = voiceChannel.permissionsFor(msg.client.user);
		if (!permissions.has('CONNECT')) {
			return msg.channel.send('I cannot connect to your voice channel, make sure I have the proper permissions!');
		}
		if (!permissions.has('SPEAK')) {
			return msg.channel.send('I cannot speak in this voice channel, make sure I have the proper permissions!');
		}

		if (url.match(/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/)) {
			const playlist = await youtube.getPlaylist(url);
			const videos = await playlist.getVideos();
			for (const video of Object.values(videos)) {
				const video2 = await youtube.getVideoByID(video.id); // eslint-disable-line no-await-in-loop
				await handleVideo(video2, msg, voiceChannel, true); // eslint-disable-line no-await-in-loop
			}
			return msg.channel.send(`✅ Playlist: **${playlist.title}** has been added to the queue!`);
		} else {
			try {
				var video = await youtube.getVideo(url);
			} catch (error) {
				try {
					var videos = await youtube.searchVideos(searchString, 10);
					let index = 0;
					msg.channel.send(`
__**Song selection:**__
${videos.map(video2 => `**${++index} -** ${video2.title}`).join('\n')}
**Please provide a value to select one of the search results ranging from \`1-10\`.**
					`).then(msg => msg.delete(10000));
					// eslint-disable-next-line max-depth
					try {
						var response = await msg.channel.awaitMessages(msg2 => msg2.content > 0 && msg2.content < 11, {
							maxMatches: 1,
							time: 10000,
							errors: ['time']
						});
					} catch (err) {
						console.error(err);
						return msg.channel.send('**No or invalid value entered, cancelling video selection.**').then(msg => msg.delete(10000));
					}
					const videoIndex = parseInt(response.first().content);
					var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
				} catch (err) {
					console.error(err);
					return msg.channel.send('🆘 I could not obtain any search results.');
				}
			}
			return handleVideo(video, msg, voiceChannel);
		}
	} else if (command === 'skip') {
		if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
		if (!serverQueue) return msg.channel.send('There is nothing playing that I could skip for you.');
		serverQueue.connection.dispatcher.end('Skip command has been used!');
		return undefined;
	} else if (command === 'stop') {
		if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
		if (!serverQueue) return msg.channel.send('There is nothing playing that I could stop for you.');
		serverQueue.songs = [];
		serverQueue.connection.dispatcher.end('Stop command has been used!');
		return undefined;
	} else if (command === 'volume') {
		if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
		if (!serverQueue) return msg.channel.send('There is nothing playing.');
		if (!args[1]) return msg.channel.send(`The current volume is: **${serverQueue.volume}**`);
		serverQueue.volume = args[1];
		serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 5);
		return msg.channel.send(`I set the volume to: **${args[1]}**`);
	} else if (command === 'np') {
		if (!serverQueue) return msg.channel.send('There is nothing playing.');
		return msg.channel.send(`🎶 Now playing: **${serverQueue.songs[0].title}**`);
	} else if (command === 'queue') {
		if (!serverQueue) return msg.channel.send('There is nothing playing.');
		return msg.channel.send(`
__**Song queue:**__
${serverQueue.songs.map(song => `**-** ${song.title}`).join('\n')}
**Now playing:** ${serverQueue.songs[0].title}
		`);
	} else if (command === 'pause') {
		if (serverQueue && serverQueue.playing) {
			serverQueue.playing = false;
			serverQueue.connection.dispatcher.pause();
			return msg.channel.send('⏸ Paused the music for you!');
		}
		return msg.channel.send('There is nothing playing.');
	} else if (command === 'resume') {
		if (serverQueue && !serverQueue.playing) {
			serverQueue.playing = true;
			serverQueue.connection.dispatcher.resume();
			return msg.channel.send('▶ Resumed the music for you!');
		}
		return msg.channel.send('There is nothing playing.');
	}

	return undefined;
});

async function handleVideo(video, msg, voiceChannel, playlist = false) {
	const serverQueue = queue.get(msg.guild.id);
	console.log(video);
	const song = {
		id: video.id,
		title: Util.escapeMarkdown(video.title),
		url: `https://www.youtube.com/watch?v=${video.id}`
	};
	if (!serverQueue) {
		const queueConstruct = {
			textChannel: msg.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: true
		};
		queue.set(msg.guild.id, queueConstruct);

		queueConstruct.songs.push(song);

		try {
			var connection = await voiceChannel.join();
			queueConstruct.connection = connection;
			play(msg.guild, queueConstruct.songs[0]);
		} catch (error) {
			console.error(`I could not join the voice channel: ${error}`);
			queue.delete(msg.guild.id);
			return msg.channel.send(`I could not join the voice channel: ${error}`);
		}
	} else {
		serverQueue.songs.push(song);
		console.log(serverQueue.songs);
		if (playlist) return undefined;
		else return msg.channel.send(`✅ **${song.title}** has been added to the queue!`);
	}
	return undefined;
}

function play(guild, song) {
	const serverQueue = queue.get(guild.id);

	if (!song) {
		serverQueue.voiceChannel.leave();
		queue.delete(guild.id);
		return;
	}
	console.log(serverQueue.songs);

	const dispatcher = serverQueue.connection.playStream(ytdl(song.url))
		.on('end', reason => {
			if (reason === 'Stream is not generating quickly enough.') console.log('Song ended.');
			else console.log(reason);
			serverQueue.songs.shift();
			play(guild, serverQueue.songs[0]);
		})
		.on('error', error => console.error(error));
	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

	serverQueue.textChannel.send(`🎶 Start playing: **${song.title}**`);
}

client.login(TOKEN);

//Events

client.on(`guildMemberAdd`, async member => {
	//Welcome a member
	console.log(`${member.guild.name} got ${member.guild.memberCount}`)

	let wcChannel = member.guild.channels.find(`name`, `welcome-logs`);
	if(!wcChannel) return;

	let wcEmbed = new Discord.RichEmbed()
	.setTitle(`Welcome **${member.user.username}** to **${member.guild.name}**`)
	.setColor(`#00FF00`)
	.setThumbnail(`${member.user.displayAvatarURL}`)
	.setDescription(`You are the **${member.guild.memberCount}** member of **${member.guild.name}**`)

	wcChannel.send(wcEmbed);
	member.send(wcEmbed);

	if(member.guild.id != "453325383023198219")return undefined;
	let defaultrole = member.guild.roles.find("name", "Fans");
	member.addRole(defaultrole);

return;

client.on(`guildMemberRemove`, async member => {
	//GoodBye Member
	let gbChannel = member.guild.channels.find(`name`, `goodbye-logs`);
	if(!gbChannel) return;

	let gbEmbed = new Discord.RichEmbed()
	.setTitle(`We feel sad to see you leave the ${member.guild.name} ${member.user.username}`)
	.setDescription(`We feel that you might come back to ${member.guild.name}.`)

	gbChannel.send(gbEmbed);
return
});

});

//Commands

client.on('message', async msg => { // eslint-disable-line

		//custom prefix here

		let prefixes = JSON.parse(fs.readFileSync("./prefixes.json", "utf8"));

		if(!prefixes[msg.guild.id]){
			prefixes[msg.guild.id] = {
				prefixes: config.PREFIX
			};
		}
	
		let PREFIX = prefixes[msg.guild.id].prefixes;
	
		//custom prefix ends


	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;
	
const args = msg.content.split(' ').slice(1);
let cmd = msg.content.toLowerCase().split(' ')[0];
cmd = cmd.slice(PREFIX.length)

    if(cmd === "help") {
		//${prefix}help
        let helpEmbed = new Discord.RichEmbed()
        .setColor(`#ff7400`)
		.setTitle("μ's bot command list")
		.setDescription(`Requested in ${msg.guild.name}`)
        .addField("μ's Prefix", `===> ${PREFIX}`)
        .addField(`${PREFIX}play <title or author>`, "To Play A Song")
        .addField(`${PREFIX}queue`,"To Check The List Of Songs Added")
        .addField(`${PREFIX}skip`,"Skip and go to the next song")
        .addField(`${PREFIX}pause`,"To Pause The Song")
        .addField(`${PREFIX}resume`,"To Resume The Song")
		.addField(`${PREFIX}stop`,"To Stop Playing The Song")
		.addBlankField()
		.addField(`${PREFIX}prefix`, "To know the current prefix")
		.addField(`${PREFIX}botinfo`,"To know about the bot")
		.addField(`${PREFIX}links`,"To get tthe bot to your server or join out offical server")
		.addBlankField()
		//.addField(`${PREFIX}setprefix <New prefix>`,"To change the prefix")
		.addField(`${PREFIX}ehelp`,"Event helps")
		.setFooter(`Requested by ${msg.author.tag}`)

		
		msg.reply(`:mailbox_with_mail: It has been send to your DMs`).then(msg => msg.delete(5000))
		msg.member.send(helpEmbed);
		return msg.delete(5000);
		
	}else if(cmd === "botinfo") {
		let botinfoEmbed = new Discord.RichEmbed()
		.setColor("#15ff00")
		.setTitle("μ's bot info")
		.addField(`Bot made by`, `PokemonLeader#1712`)
		.addField(`Bot Goal`,`To be a successful Music Bot`)
		.addField(`Playing on`,`${client.guilds.size} Servers`)
		.addField(`Bot created on`, client.user.createdAt.toDateString(), true)
		.setFooter(`Requested by ${msg.author.tag}`)

		return msg.channel.send(botinfoEmbed);

	}else if(cmd === "links") {
		let inviteEmbed = new Discord.RichEmbed()
		.setTitle('Links')
		.setDescription(`
		[Invite the bot to your server](https://discordbots.org/bot/453326934949101568/)
		.\n[Join Our Offical Discord Server](https://discord.gg/6xMSP7Q)
		.\n[Donate to US](https://www.patreon.com/musebot)
		.\n[Upvote the bot](https://discordbots.org/bot/453326934949101568/vote)
		`)
		.setFooter(`Requested by ${msg.author.tag}`)

		return msg.channel.send(inviteEmbed);

	}else if(cmd === "ehelp") {

		let eventhelp = new Discord.RichEmbed()
		.setTitle("Event help")
		.addField(`add "welcome-logs" text channel`,"For the bot to send a welcome message if a player joins")
		.addField(`add "goodbye-logs" text channel`,"For the bot to text a goodbye message if the player leaves")
		.setFooter(`Requested by ${msg.user.tag}`)

		return msg.channel.send(eventhelp)
	}else if(cmd ==="setprefix") {
		
		if(!msg.member.hasPermission("MANAGE_GUILD")) return msg.reply("You don't have permission").then(msg => msg.delete(5000))
		if(!args[0] || args [0 === "help"]) return msg.channel.send(`Usage: ${PREFIX}setprefix <new perfix here>`).then(msg => msg.delete(5000));

		prefixes[msg.guild.id] = {
			prefixes: args[0]
		};

		fs.writeFile("./prefixes.json", JSON.stringify(prefixes), (err) => {
			if (err) console.log(err)
		});

		let prefixEmbed = new Discord.RichEmbed()

		.setTitle(`Prefix has been set to ${args[0]}`)
		.setColor("#FF9900")

		msg.channel.send(prefixEmbed);

	}else if(cmd ==="prefix"){
		let pcheckembed = new Discord.RichEmbed()
		.setTitle(`Prefix is ${PREFIX}`)

		msg.channel.send(pcheckembed);
	}else if(cmd ==="updates"){
		
		msg.channel.send(`
		**All updates on the bot will be announced here!!**
		1.Custom Prefix is now removed.
		2.Bot has been approved in Discord Bot List
		`)
	}

});
