-- Script para generar la tabla de usuarios en Supabase

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    apps_access JSONB DEFAULT '{}'::jsonb
);

-- Insertar el usuario administrador inicial
-- jrecuero@altim.es
-- Contraseña encriptada para: Altim2031@
-- Permisos sobre las tres aplicaciones del gestor
INSERT INTO usuarios (name, email, password, apps_access) 
VALUES (
    'Javier Recuero Romero', 
    'jrecuero@altim.es', 
    '$2b$10$cJKlsiy/7UOS/it2.ElDqOxtPFKo8n4/sm4FC7wbOCK0J4TkJ/xSi', 
    '{"accOpe": true, "accProj": true, "accConf": true}'::jsonb
) 
ON CONFLICT (email) DO NOTHING;
