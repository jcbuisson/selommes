import { ref, computed } from 'vue';
import { io } from "socket.io-client";
// import { expressXClient, reloadPlugin, offlinePlugin } from "@jcbuisson/express-x-client";
import { createClient, reloadPlugin, offlinePlugin } from "/src/client.mts";


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

export const app = createClient(socket, { debug: false });

app.configure(reloadPlugin);

// enrich `app` object of new methods, attributes and listeners (createOfflineModel, etc.)
app.configure(offlinePlugin);
// app.configure(offlinePlugin, [
//    { modelName: 'user', fields: ['name'] },
//    { modelName: 'selection', fields: ['userId', 'start', 'end'] },
// ]);

export const userModel = app.createOfflineModel('user', ['name']);
export const selectionModel = app.createOfflineModel('selection', ['userId', 'start', 'end']);

export const connectedDate = ref()
export const disconnectedDate = ref()

app.addConnectListener(async (_socket) => {
   connectedDate.value = new Date()
   console.log('onConnect', connectedDate.value)
   disconnectedDate.value = null
   app.isConnected = true
})

app.addDisconnectListener(async (_socket) => {
   connectedDate.value = null
   disconnectedDate.value = new Date()
   console.log('onDisconnect', disconnectedDate.value)
   app.isConnected = false
})

// export const isConnected = computed(() => !!connectedDate?.value);
