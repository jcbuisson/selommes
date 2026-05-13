<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
   <div class="not-connected">
      <button class="btn" @click="router.push('/auth')">Essayer à nouveau...</button>
   </div>
</template>

<style scoped>
.not-connected {
   display: flex;
   align-items: center;
   justify-content: center;
   min-height: 100vh;
   background: #181825;
}

.btn {
   padding: 1rem 2.25rem;
   border-radius: 8px;
   border: none;
   background: #89b4fa;
   color: #1e1e2e;
   font-size: 0.95rem;
   font-weight: 600;
   cursor: pointer;
   transition: background 0.15s;
}

.btn:hover {
   background: #b4d0fb;
}
</style>
