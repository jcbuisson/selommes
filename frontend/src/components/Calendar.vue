<script setup>
import { ref, computed } from 'vue'


const MONTH_NAMES = [
   'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
   'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const WEEKDAY_LABELS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']

const emit = defineEmits(['select'])

const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())

const selectionStart = ref(null)
const selectionEnd = ref(null)
const isDragging = ref(false)

const monthLabel = computed(() =>
   `${MONTH_NAMES[currentMonth.value]} ${currentYear.value}`
)

const daysInGrid = computed(() => {
   const firstDay = new Date(currentYear.value, currentMonth.value, 1)
   const lastDay = new Date(currentYear.value, currentMonth.value + 1, 0)
   const startPad = (firstDay.getDay() + 6) % 7 // 0 = Monday

   const days = []
   for (let i = startPad; i > 0; i--) {
      days.push({ date: new Date(currentYear.value, currentMonth.value, 1 - i), inMonth: false })
   }
   for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(currentYear.value, currentMonth.value, d), inMonth: true })
   }
   const remaining = 42 - days.length
   for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(currentYear.value, currentMonth.value + 1, d), inMonth: false })
   }
   return days
})

// Always keep start <= end for rendering
const range = computed(() => {
   if (!selectionStart.value || !selectionEnd.value) return { start: null, end: null }
   return selectionStart.value <= selectionEnd.value
      ? { start: selectionStart.value, end: selectionEnd.value }
      : { start: selectionEnd.value, end: selectionStart.value }
})

function dayClasses(date) {
   const { start, end } = range.value
   if (!start) return {}
   const t = date.getTime()
   const inRange = t >= start.getTime() && t <= end.getTime()
   return {
      'in-range': inRange,
      'range-start': inRange && t === start.getTime(),
      'range-end': inRange && t === end.getTime(),
   }
}

function prevMonth() {
   if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value-- }
   else currentMonth.value--
}

function nextMonth() {
   if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value++ }
   else currentMonth.value++
}

// ── Mouse ──────────────────────────────────────────────────────────────────

function onMouseDown(date) {
   isDragging.value = true
   selectionStart.value = date
   selectionEnd.value = date
}

function onMouseEnter(date) {
   if (isDragging.value) selectionEnd.value = date
}

function onDragEnd() {
   if (!isDragging.value) return
   isDragging.value = false
   if (range.value.start) emit('select', { start: range.value.start, end: range.value.end })
}

// ── Touch ──────────────────────────────────────────────────────────────────
// touchmove fires on the element where the touch started, not under the finger.
// We use elementFromPoint + closest('[data-date]') to resolve the current cell.

function onTouchStart(date) {
   isDragging.value = true
   selectionStart.value = date
   selectionEnd.value = date
}

function onTouchMove(event) {
   if (!isDragging.value) return
   const touch = event.touches[0]
   const el = document.elementFromPoint(touch.clientX, touch.clientY)
   const cell = el?.closest('[data-date]')
   if (cell?.dataset.date) {
      selectionEnd.value = new Date(cell.dataset.date)
   }
}

function formatDate(date) {
   return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
   <div class="calendar" @mouseup="onDragEnd" @mouseleave="onDragEnd">

      <!-- header -->
      <div class="calendar-header">
         <button class="nav-btn" @click="prevMonth">&#8249;</button>
         <span class="month-label">{{ monthLabel }}</span>
         <button class="nav-btn" @click="nextMonth">&#8250;</button>
      </div>

      <!-- grid with selections -->
      <div
         class="calendar-grid"
         @touchmove.prevent="onTouchMove"
         @touchend="onDragEnd"
      >
         <div class="weekday-label" v-for="d in WEEKDAY_LABELS" :key="d">{{ d }}</div>

         <div
            v-for="day in daysInGrid"
            :key="day.date.toISOString()"
            class="day-cell"
            :class="[dayClasses(day.date), { 'other-month': !day.inMonth }]"
            :data-date="day.date.toISOString()"
            @mousedown.prevent="onMouseDown(day.date)"
            @mouseenter="onMouseEnter(day.date)"
            @touchstart.prevent="onTouchStart(day.date)"
         >
            {{ day.date.getDate() }}
         </div>
      </div>

      <!-- footer-->
      <div v-if="range.start" class="selection-info">
         <template v-if="range.start.getTime() === range.end.getTime()">
            {{ formatDate(range.start) }}
         </template>
         <template v-else>
            {{ formatDate(range.start) }} &rarr; {{ formatDate(range.end) }}
         </template>
      </div>
   </div>
</template>

<style scoped>
.calendar {
   user-select: none;
   width: 320px;
   background: #1e1e2e;
   border-radius: 16px;
   padding: 16px;
   box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
   color: #cdd6f4;
   font-family: inherit;
}

/* ── Header ── */
.calendar-header {
   display: flex;
   align-items: center;
   justify-content: space-between;
   margin-bottom: 12px;
}

.nav-btn {
   background: none;
   border: none;
   color: #cdd6f4;
   font-size: 1.8em;
   line-height: 1;
   padding: 2px 8px;
   border-radius: 8px;
   cursor: pointer;
}

.nav-btn:hover {
   background: rgba(205, 214, 244, 0.1);
}

.month-label {
   font-size: 1.05em;
   font-weight: 600;
}

/* ── Grid ── */
.calendar-grid {
   display: grid;
   grid-template-columns: repeat(7, 1fr);
   touch-action: none; /* Prevents scroll-fighting during drag */
}

.weekday-label {
   text-align: center;
   font-size: 0.72em;
   font-weight: 600;
   color: #6c7086;
   padding-bottom: 6px;
}

.day-cell {
   display: flex;
   align-items: center;
   justify-content: center;
   height: 40px;
   font-size: 0.88em;
   border-radius: 8px;
   cursor: pointer;
   transition: background 0.1s;
}

.day-cell:hover {
   background: rgba(205, 214, 244, 0.08);
}

.day-cell.other-month {
   color: #45475a;
}

/* ── Range highlight ── */

/* Middle days */
.day-cell.in-range {
   background: rgba(137, 180, 250, 0.18);
   border-radius: 0;
   color: #cdd6f4;
}

/* Start cap */
.day-cell.range-start {
   background: #89b4fa;
   border-radius: 8px 0 0 8px;
   color: #1e1e2e;
   font-weight: 700;
}

/* End cap */
.day-cell.range-end {
   background: #89b4fa;
   border-radius: 0 8px 8px 0;
   color: #1e1e2e;
   font-weight: 700;
}

/* Single-day selection */
.day-cell.range-start.range-end {
   border-radius: 8px;
}

/* ── Footer ── */
.selection-info {
   margin-top: 12px;
   text-align: center;
   font-size: 0.82em;
   color: #a6adc8;
   min-height: 1.2em;
}

/* ── Light mode ── */
@media (prefers-color-scheme: light) {
   .calendar {
      background: #ffffff;
      color: #213547;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
   }

   .nav-btn {
      color: #213547;
   }

   .nav-btn:hover {
      background: rgba(33, 53, 71, 0.08);
   }

   .weekday-label {
      color: #9ca3af;
   }

   .day-cell {
      color: #213547;
   }

   .day-cell:hover {
      background: rgba(33, 53, 71, 0.06);
   }

   .day-cell.other-month {
      color: #d1d5db;
   }

   .day-cell.in-range {
      background: rgba(99, 102, 241, 0.12);
      color: #213547;
   }

   .day-cell.range-start,
   .day-cell.range-end {
      background: #6366f1;
      color: #ffffff;
   }

   .selection-info {
      color: #6b7280;
   }
}
</style>
