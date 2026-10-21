# Transport Ledger

Transport Invoice & Calculation Management System.

## Project files

- index.html: website layout
- styles.css: website styling
- config.js: Supabase connection configuration
- app.js: application logic
- sql/schema.sql: database schema and security policies

## Features in the starter version

- Supabase administrator login
- Dashboard summary
- Transport record creation, editing and deletion
- Customer profile management
- Invoice register
- Invoice status and paid/outstanding fields
- Date-range report preview
- PDF export
- Currency selection
- Audit log table

## Setup

### 1. Create a Supabase project

Create a project in Supabase and wait until the database is ready.

### 2. Create database tables

Open the Supabase SQL Editor.

Open `sql/schema.sql` in VS Code, copy its SQL, paste it into the SQL Editor, and run it.

### 3. Create your administrator

In Supabase Authentication, create a user with your administrator email and password.

Copy that user's UUID.

Run this query in the SQL Editor, replacing the example UUID:

```sql
INSERT INTO public.profiles (id, full_name, role)
VALUES (
    '0d2a7eaf-8996-4398-af96-a074910f66de',
    'Administrator',
    'admin'
);