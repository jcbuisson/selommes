<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useObservable } from '@vueuse/rxjs'

import useUser from '/src/use/useUser'
import { app } from '/src/client-app.ts'
import COLORS from '/src/colors.mjs'

const props = defineProps({
   email: { type: String, default: '' },
   color: { type: String, default: '' },
})

const { create: createUser, getObservable: users$ } = useUser(app)

const router = useRouter()

const users = useObservable(users$({}))
const usedColors = computed(() => new Set(users.value?.map(u => u.color) ?? []))

const email = ref(props.email)
const name = ref('')
const color = ref(COLORS.includes(props.color) ? props.color : COLORS[0])

// Once users load, move to the first available color if the current one is taken
watch(usedColors, (used) => {
   if (used.has(color.value)) {
      color.value = COLORS.find(c => !used.has(c)) ?? color.value
   }
}, { once: true })

async function onSubmit() {
   const user = await createUser({
      email: email.value,
      name: name.value,
      color: color.value,
   })
   console.log('user', user);
   localStorage.setItem('selommes_user_uid', user.uid);
   localStorage.setItem('selommes_color', user.color);
   localStorage.setItem('selommes_name', user.name);
   router.push('/agenda');
}
</script>

<template>
   <div class="wrapper">
      <form class="form" @submit.prevent="onSubmit">
         <h1 class="title">Créer un compte</h1>

         <div class="field">
            <label class="field-label" for="email">Adresse e-mail</label>
            <input
               id="email"
               v-model="email"
               class="field-input"
               type="email"
               placeholder="vous@exemple.fr"
               autocomplete="email"
               required
            />
         </div>

         <div class="field">
            <label class="field-label" for="name">Nom</label>
            <input
               id="name"
               v-model="name"
               class="field-input"
               type="text"
               placeholder="Votre nom"
               required
            />
         </div>

         <div class="field">
            <label class="field-label">Couleur</label>
            <div class="color-swatches">
               <button
                  v-for="c in COLORS"
                  :key="c"
                  type="button"
                  class="swatch"
                  :class="{ selected: c === color, taken: usedColors.has(c) }"
                  :style="{ background: c }"
                  :disabled="usedColors.has(c)"
                  @click="color = c"
               />
            </div>
         </div>

         <button class="submit-btn" type="submit" :disabled="!email.trim() || !name.trim()">Créer</button>
      </form>
   </div>
</template>

<style scoped>
.wrapper {
   display: flex;
   align-items: center;
   justify-content: center;
   min-height: 100vh;
   background: #181825;
}

.form {
   background: #1e1e2e;
   border: 1px solid #313244;
   border-radius: 12px;
   padding: 2rem;
   width: 100%;
   max-width: 360px;
   display: flex;
   flex-direction: column;
   gap: 1.25rem;
   box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.title {
   margin: 0;
   font-size: 1.2rem;
   font-weight: 700;
   color: #cdd6f4;
}

.field {
   display: flex;
   flex-direction: column;
   gap: 0.4rem;
}

.field-label {
   font-size: 0.85rem;
   font-weight: 500;
   color: #a6adc8;
}

.field-input {
   background: #313244;
   border: 1px solid #45475a;
   border-radius: 8px;
   padding: 0.5rem 0.75rem;
   color: #cdd6f4;
   font-size: 0.95rem;
   outline: none;
   transition: border-color 0.15s;
}

.field-input:focus {
   border-color: #89b4fa;
}

.color-swatches {
   display: flex;
   flex-wrap: wrap;
   gap: 8px;
}

.swatch {
   width: 28px;
   height: 28px;
   border-radius: 50%;
   border: 2px solid transparent;
   cursor: pointer;
   padding: 0;
   outline: none;
   transition: transform 0.1s, border-color 0.1s;
}

.swatch:hover {
   transform: scale(1.15);
}

.swatch.selected {
   border-color: #cdd6f4;
   transform: scale(1.15);
}

.swatch.taken {
   opacity: 0.25;
   cursor: not-allowed;
   transform: none;
}

.submit-btn {
   padding: 0.55rem 1rem;
   border-radius: 8px;
   border: none;
   background: #89b4fa;
   color: #1e1e2e;
   font-size: 0.95rem;
   font-weight: 600;
   cursor: pointer;
   transition: background 0.15s;
}

.submit-btn:hover:not(:disabled) {
   background: #b4d0fb;
}

.submit-btn:disabled {
   opacity: 0.4;
   cursor: default;
}
</style>
