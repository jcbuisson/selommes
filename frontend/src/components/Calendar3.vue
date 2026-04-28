<script setup>
import { ref, computed } from 'vue'


const MONTH_NAMES = [
   'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
   'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const WEEKDAY_LABELS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']

const props = defineProps({
   // [{ label: String, color: String, start: Date|string, end: Date|string }]
   ranges: { type: Array, default: () => [] },
})

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
   const startPad = (firstDay.getDay() + 6) % 7

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

// Group flat 42-cell grid into 6 weeks of 7 days
const weeks = computed(() => {
   const g = daysInGrid.value
   return Array.from({ length: 6 }, (_, i) => g.slice(i * 7, (i + 1) * 7))
})

// Always keep start <= end for the active drag selection
const activeRange = computed(() => {
   if (!selectionStart.value || !selectionEnd.value) return { start: null, end: null }
   return selectionStart.value <= selectionEnd.value
      ? { start: selectionStart.value, end: selectionEnd.value }
      : { start: selectionEnd.value, end: selectionStart.value }
})

// Prop ranges with Date objects normalised and a stable band index
const normalizedRanges = computed(() =>
   props.ranges.map((r, i) => ({
      ...r,
      band: i,
      start: r.start instanceof Date ? r.start : new Date(r.start),
      end:   r.end   instanceof Date ? r.end   : new Date(r.end),
   }))
)

// For each week, slice every range into a segment (colStart, colSpan, caps)
const weekSegments = computed(() =>
   weeks.value.map(weekDays => {
      const ws = weekDays[0].date.getTime()
      const we = weekDays[6].date.getTime()
      const segs = []

      for (const r of normalizedRanges.value) {
         const rs = r.start.getTime()
         const re = r.end.getTime()
         if (re < ws || rs > we) continue

         let firstCol = -1, lastCol = -1
         for (let i = 0; i < 7; i++) {
            const t = weekDays[i].date.getTime()
            if (t >= rs && t <= re) {
               if (firstCol === -1) firstCol = i
               lastCol = i
            }
         }
         if (firstCol === -1) continue

         segs.push({
            key: r.label + weekDays[0].date.toISOString(),
            label: r.label,
            color: r.color,
            colStart: firstCol + 1, // CSS grid is 1-based
            colSpan: lastCol - firstCol + 1,
            startsHere: rs >= ws,
            endsHere:   re <= we,
         })
      }

      return segs
   })
)

// Inline style for each bar segment: grid placement + rounded caps + color
function barStyle(seg) {
   const tl = seg.startsHere ? '6px' : '0'
   const tr = seg.endsHere   ? '6px' : '0'
   const br = seg.endsHere   ? '6px' : '0'
   const bl = seg.startsHere ? '6px' : '0'
   return {
      gridColumn: `${seg.colStart} / span ${seg.colSpan}`,
      background: seg.color,
      borderRadius: `${tl} ${tr} ${br} ${bl}`,
      // small gap at the cap ends so the bar doesn't touch the cell edge
      marginLeft:  seg.startsHere ? '2px' : '0',
      marginRight: seg.endsHere   ? '2px' : '0',
   }
}

function dayClasses(date) {
   const { start, end } = activeRange.value
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
   if (activeRange.value.start) emit('select', { start: activeRange.value.start, end: activeRange.value.end })
}

// ── Touch ──────────────────────────────────────────────────────────────────

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
   <div class="calendar" @mouseup="onDragEnd" @mouseleave="onDragEnd" @touchend="onDragEnd">

      <!-- header -->
      <div class="calendar-header">
         <button class="nav-btn" @click="prevMonth">&#8249;</button>
         <span class="month-label">{{ monthLabel }}</span>
         <button class="nav-btn" @click="nextMonth">&#8250;</button>
      </div>

      <!-- weekday labels (shared across all weeks) -->
      <div class="weekday-labels">
         <div class="weekday-label" v-for="d in WEEKDAY_LABELS" :key="d">{{ d }}</div>
      </div>

      <!-- 6 week blocks: day cells in row 1, range bars auto-flow into rows 2+ -->
      <div
         v-for="(week, wi) in weeks"
         :key="wi"
         class="week-block"
         @touchmove.prevent="onTouchMove"
      >
         <div
            v-for="day in week"
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

         <div
            v-for="seg in weekSegments[wi]"
            :key="seg.key"
            class="range-bar"
            :style="barStyle(seg)"
         >
            <span v-if="seg.startsHere" class="bar-label">{{ seg.label }}</span>
         </div>
      </div>

      <!-- footer: active drag selection -->
      <div v-if="activeRange.start" class="selection-info">
         <template v-if="activeRange.start.getTime() === activeRange.end.getTime()">
            {{ formatDate(activeRange.start) }}
         </template>
         <template v-else>
            {{ formatDate(activeRange.start) }} &rarr; {{ formatDate(activeRange.end) }}
         </template>
      </div>

      <!-- legend -->
      <div v-if="normalizedRanges.length" class="ranges-legend">
         <div v-for="r in normalizedRanges" :key="r.label" class="legend-item">
            <span class="legend-swatch" :style="{ background: r.color }" />
            <span class="legend-label">{{ r.label }}</span>
         </div>
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

/* ── Weekday labels ── */
.weekday-labels {
   display: grid;
   grid-template-columns: repeat(7, 1fr);
   margin-bottom: 2px;
}

.weekday-label {
   text-align: center;
   font-size: 0.72em;
   font-weight: 600;
   color: #6c7086;
   padding-bottom: 6px;
}

/* ── Week blocks ── */
/* Each block is a 7-column grid.
   Day cells go in row 1 (explicit).
   Range bars have no grid-row — CSS auto-placement packs them into rows 2+,
   fitting non-overlapping bars into the same row automatically. */
.week-block {
   display: grid;
   grid-template-columns: repeat(7, 1fr);
   touch-action: none;
}

/* ── Day cells ── */
.day-cell {
   grid-row: 1;
   display: flex;
   align-items: center;
   justify-content: center;
   height: 36px;
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

/* ── Active selection highlight ── */
.day-cell.in-range {
   background: rgba(137, 180, 250, 0.18);
   border-radius: 0;
   color: #cdd6f4;
}

.day-cell.range-start {
   background: #89b4fa;
   border-radius: 8px 0 0 8px;
   color: #1e1e2e;
   font-weight: 700;
}

.day-cell.range-end {
   background: #89b4fa;
   border-radius: 0 8px 8px 0;
   color: #1e1e2e;
   font-weight: 700;
}

.day-cell.range-start.range-end {
   border-radius: 8px;
}

/* ── Range bars ── */
.range-bar {
   height: 16px;
   margin: 1px 0;
   display: flex;
   align-items: center;
   overflow: hidden;
   min-width: 0;
}

.bar-label {
   font-size: 0.68em;
   font-weight: 600;
   white-space: nowrap;
   overflow: hidden;
   text-overflow: ellipsis;
   padding: 0 5px;
   color: rgba(0, 0, 0, 0.65);
}

/* ── Footer ── */
.selection-info {
   margin-top: 12px;
   text-align: center;
   font-size: 0.82em;
   color: #a6adc8;
   min-height: 1.2em;
}

/* ── Legend ── */
.ranges-legend {
   margin-top: 10px;
   display: flex;
   flex-direction: column;
   gap: 5px;
}

.legend-item {
   display: flex;
   align-items: center;
   gap: 7px;
   font-size: 0.8em;
   color: #a6adc8;
}

.legend-swatch {
   width: 10px;
   height: 10px;
   border-radius: 50%;
   flex-shrink: 0;
}

.legend-label {
   line-height: 1;
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

   .legend-item {
      color: #6b7280;
   }
}
</style>
