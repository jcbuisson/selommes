import { integer, pgTable, uuid, text, date } from "drizzle-orm/pg-core";

export const metadata = pgTable("metadata", {
   id: uuid("id").defaultRandom().primaryKey(), // 👈 UUID PK
   created_at: date(),
   updated_at: date(),
   deleted_at: date(),
})

export const user = pgTable("user", {
   id: uuid("id").defaultRandom().primaryKey(), // 👈 UUID PK
   email: text().notNull(),
   name: text().notNull(),
   color: text().notNull(),
});

export const range = pgTable("range", {
   id: uuid("id").defaultRandom().primaryKey(), // 👈 UUID PK
   user_uid: uuid("id").notNull().references(() => userTable.id),
   start: text().notNull(),
   end: text().notNull(),
   label: text().notNull(),
   color: text().notNull(),
});
