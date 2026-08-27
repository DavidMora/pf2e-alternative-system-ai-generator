/*
 * A genuine second Foundry client, connected as the player.
 *
 * This is the one path no unit test can reach: the relay only works if a
 * message crosses the server from a player's socket to the GM's, and both
 * halves live in different processes. Everything else about the roll is
 * already covered; this is the wire.
 */
import { io } from 'socket.io-client';

const [, , session, action, payloadJson] = process.argv;

const socket = io('http://localhost:30000', {
  transports: ['websocket'],
  extraHeaders: { Cookie: `session=${session}` },
  query: { session },
});

const done = (code, message) => { console.log(message); socket.close(); process.exit(code); };
setTimeout(() => done(1, 'TIMEOUT: never connected'), 12000);

socket.on('connect', () => {
  console.log(`connected as a second client, socket ${socket.id}`);
  socket.emit('module.matadragones-subsystems-implementation-for-pf2e', {
    action, ...JSON.parse(payloadJson),
  });
  console.log(`emitted ${action}`);
  // Give the server time to fan it out before dropping the connection.
  setTimeout(() => done(0, 'emitted and disconnected'), 1500);
});

socket.on('connect_error', (e) => done(1, `connect_error: ${e.message}`));
