<script setup>
import { ref, computed } from 'vue'
import { v7 as uuidv7 } from 'uuid'
import { useObservable } from '@vueuse/rxjs'

import { app, selectionModel } from '/src/client-app.ts';

import Calendar from '/src/components/Calendar.vue'


const selections$ = selectionModel.getObservable();

const selections = useObservable(selections$)

function onSelect({ start, end }) {
   console.log('Selected range:', start, '→', end)
}

async function create() {
   // const uid = uuidv7()
   const selection = await selectionModel.create({
      text:'test',
      start: '1962-12-27',
      end: '1962-12-27',
      userUid: '1234azer',
   })
   console.log('selection', selection)
}
</script>

<template>
   {{ selections }}
   <Calendar @select="onSelect" />
   <button @click="create">create</button>
</template>
