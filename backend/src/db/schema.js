import { pgTable, uuid, text, date } from "drizzle-orm/pg-core";

export const metadata = pgTable("metadata", {
   uid: uuid("uid").defaultRandom().primaryKey(),
   created_at: date(),
   updated_at: date(),
   deleted_at: date(),
})

export const user = pgTable("user", {
   uid: uuid("uid").defaultRandom().primaryKey(),
   email: text().notNull(),
   name: text().notNull(),
   color: text().notNull(),
});

export const range = pgTable("range", {
   uid: uuid("uid").defaultRandom().primaryKey(),
   user_uid: uuid("user_uid").references(() => user.uid),
   start: text().notNull(),
   end: text().notNull(),
   label: text().notNull(),
   color: text().notNull(),
});
