import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const metadata = pgTable("metadata", {
   uid: uuid("uid").defaultRandom().primaryKey(),
   created_at: timestamp(),
   updated_at: timestamp(),
   deleted_at: timestamp(),
})

export const user = pgTable("user", {
   uid: uuid("uid").defaultRandom().primaryKey(),
   email: text().notNull().unique(),
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
