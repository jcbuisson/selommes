<script setup>
// import { useObservable } from '@vueuse/rxjs'

import Calendar from '/src/components/Calendar.vue'
import Calendar2 from '/src/components/Calendar2.vue'


import useSelection from '/src/use/useSelection';

import { app } from '/src/client-app.ts';

const { getObservable: selections$, create: createSelection } = useSelection(app);

// const selections = useObservable(selections$({}))


function onSelect({ start, end }) {
   console.log('Selected range:', start, '→', end)
}

async function create() {
   const selection = await createSelection({
      text:'test',
      start: '1962-12-27',
      end: '1962-12-27',
      userUid: '1234azer',
   })
   console.log('selection', selection)
}
</script>

<template>
   <!-- {{ selections }} -->
   <Calendar @select="onSelect" />
   <Calendar2 @select="onSelect" />
   <!-- <button @click="create">create</button> -->
</template>
