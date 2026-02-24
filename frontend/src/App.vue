<script setup>
import Calendar from './components/Calendar.vue'

function onSelect({ start, end }) {
   console.log('Selected range:', start, '→', end)
}
</script>

<template>
   <Calendar @select="onSelect" />
</template>
