
import nodemailer from 'nodemailer'

export default function (app) {
   
   const nodemailerConfig = {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: false,
      auth: {
         user: process.env.MAIL_USER,
         pass: process.env.MAIL_PASSWORD,
      },
      name: process.env.MAIL_DOMAIN,
   }

   // client must call it with a greater timeout than the default 5000ms
   app.createService('mail', {
      send: async ({ to, subject, text, html }) => {
         const transporter = nodemailer.createTransport(nodemailerConfig)
         return transporter.sendMail({ from: process.env.MAIL_SENDER, to, subject, text, html })
      },
   })
}
