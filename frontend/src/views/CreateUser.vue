<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import useUser from '/src/use/useUser'
import { app } from '/src/client-app.ts'

const props = defineProps({
   email: { type: String, default: '' },
   color: { type: String, default: '#89b4fa' },
})

const { create: createUser } = useUser(app)

const router = useRouter()

const email = ref(props.email)
const name = ref('')
const color = ref(props.color)

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
            <label class="field-label" for="color">Couleur</label>
            <input
               id="color"
               v-model="color"
               class="field-input color-input"
               type="color"
            />
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

.color-input {
   padding: 0.25rem 0.4rem;
   height: 40px;
   cursor: pointer;
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
