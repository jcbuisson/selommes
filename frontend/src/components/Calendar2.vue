<script setup>
import { ref, computed } from 'vue'

const lines = [
   { type: 'day-cell', content: [{ text: '30', light: true}, {text: '1'}, {text: '2'}, {text: '3'}, {text: '4'}, {text: '5'}, {'text': '6'}] },
   { type: 'selection', start: 2, end: 4, color: 'red', text: "Nora & compagnie" },
   { type: 'selection', start: 3, end: 6, color: 'blue', text: "Anne" },
   { type: 'day-cell', content: [{ text: '7'}, {text: '8'}, {text: '9'}, {text: '10'}, {text: '11'}, {text: '12'}, {'text': '13'}] },
   { type: 'selection', start: 0, end: 2, color: 'blue', text: "Anne" },
   { type: 'day-cell', content: [{ text: '14'}, {text: '15'}, {text: '16'}, {text: '17'}, {text: '18'}, {text: '19'}, {'text': '20'}] },
]
</script>

<template>
   <div class="calendar">
      <div class="calendar-line">
         <div v-for="line, index in lines" :key="index" :class="line.type">
            <template v-if="line.type === 'day-cell'">
               <div v-for="cell in line.content">
                  {{ cell.text }}
               </div>
            </template>
            <template v-else>
               {{ line.text }}
            </template>
         </div>
      </div>
   </div>
</template>

<style scoped>
.calendar {
   user-select: none;
   max-width: 320px;
   border-radius: 16px;
   padding: 16px;
   box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
   color: #cdd6f4;
   font-family: inherit;
}

.calendar-line {
   /* display: flex; */
}


.day-cell {
   display: flex;
   /* align-items: center;
   justify-content: center; */
   height: 40px;
   width: 40px;
   font-size: 0.88em;
   border-radius: 8px;
   cursor: pointer;
   transition: background 0.1s;
}

.day-cell:hover {
   background: rgba(205, 214, 244, 0.08);
}
</style>
