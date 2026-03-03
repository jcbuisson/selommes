import { io } from "socket.io-client";
import { createClient, reloadPlugin, offlinePlugin } from "@jcbuisson/express-x-client";
// import { createClient, reloadPlugin, offlinePlugin } from "/src/client.mts";


const socketOptions = {
   path: '/selommes-socket-io/',
   transports: ["websocket"],
   reconnectionDelay: 1000,
   reconnectionDelayMax: 10000,
   extraHeaders: {
      "bearer-token": "mytoken",
   },
};

const socket = io(socketOptions);

export const app = createClient(socket, { debug: true });

app.configure(reloadPlugin);

app.configure(offlinePlugin);

