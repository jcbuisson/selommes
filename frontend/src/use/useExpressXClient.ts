import { io } from "socket.io-client";
import { createClient, reloadPlugin, offlinePlugin } from "@jcbuisson/express-x-client";

let socket = null;
let app: any = null;

const socketOptions = {
   path: '/selommes-socket-io/',
   transports: ["websocket"],
   reconnectionDelay: 1000,
   reconnectionDelayMax: 10000,
};

export default function useExpressXClient() {
   if (!app) {
      socket = io(socketOptions);
      app = createClient(socket, { debug: true });
      app.configure(reloadPlugin);
      app.configure(offlinePlugin);
   }

   return { app };
}
