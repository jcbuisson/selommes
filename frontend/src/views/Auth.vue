<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { app } from '/src/client-app.ts';

const router = useRouter()

const email = ref('')
const emailSent = ref(false)

async function onSubmit() {
   const user = await app.service('user').findUnique({ email: email.value });
   if (user) {
      localStorage.setItem('selommes_user_uid', user.uid);
      localStorage.setItem('selommes_user_color', user.color);
      localStorage.setItem('selommes_user_name', user.name);
      router.push('/agenda')
   } else {
      const html = `<a href="${import.meta.env.VITE_SELOMMES_URL}/create-user?email=${encodeURIComponent(email.value)}" style="display:inline-block;padding:10px 20px;background-color:#89b4fa;color:#1e1e2e;text-decoration:none;border-radius:6px;font-weight:600;">Cliquez ici</a> pour confirmer votre inscription au calendrier de Selommes`;
      await app.service('mail').send({
         to: email.value,
         subject: "Selommes, confirmation de l'email",
         text: null,
         html,
      })

      emailSent.value = true
      // router.push({
      //    path: '/create-user',
      //    query: { email: email.value },
      // })
   }
}
</script>

<template>
   <div class="auth-wrapper">
      <p v-if="emailSent" class="email-sent-msg">Veuillez consulter votre boite mail pour confirmer l'inscription</p>
      <form v-else class="auth-form" @submit.prevent="onSubmit">
         <h1 class="auth-title">Créer un compte ou se connecter</h1>
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
         <button class="submit-btn" type="submit">Valider</button>
      </form>
   </div>
</template>

<style scoped>
.auth-wrapper {
   display: flex;
   align-items: center;
   justify-content: center;
   min-height: 100vh;
   background: #181825;
}

.auth-form {
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

.auth-title {
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

.submit-btn:hover {
   background: #b4d0fb;
}

.email-sent-msg {
   color: #cdd6f4;
   font-size: 1rem;
   text-align: center;
   max-width: 360px;
   padding: 1.5rem;
   background: #1e1e2e;
   border: 1px solid #313244;
   border-radius: 12px;
}
</style>
