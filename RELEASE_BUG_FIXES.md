# Bug Fixes v2.4.2 - v2.4.5

Serie de correcciones críticas que mejoran la estabilidad y funcionalidad del MCP Azure DevOps.

## 🐛 Correcciones Incluidas

### v2.4.2
- **Version bump**: Preparación para serie de correcciones
- **Cambios**: Actualización de versión en package.json

### v2.4.3 (Commit 04e1f3a)
- **Fix(attachments)**: Clarify name parameter description in `ado_add_attachment`

#### 📝 Detalles
**Problema**: La descripción del parámetro `name` en la herramienta `ado_add_attachment` no era clara sobre su comportamiento.

**Solución**:
- Actualizar la descripción para aclarar que el parámetro `name` es opcional
- Documentar que por defecto usa el nombre del archivo original cuando no se especifica
- Mejorar la claridad de la documentación para los usuarios

**Código cambiado**:
```typescript
// Antes: "Nombre del archivo (opcional)"
// Después: "Nombre del archivo (opcional, se usa el nombre del archivo si no se especifica)"
```

### v2.4.4 (Commit 82d31fa)
- **Fix(attachments)**: Preserve fileName parameter in attachment URL

#### 📝 Detalles
**Problema Crítico**: Los nombres de archivos adjuntos no aparecían correctamente en Azure DevOps boards y listas.

**Causa Raíz**:
- Cuando se subía un adjunto, Azure DevOps devolvía una URL con parámetro `?fileName`
- Formato: `https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{id}?fileName={name}`
- El MCP estaba descartando este parámetro al reconstruir la URL para vincular

**Impacto**:
- Los adjuntos aparecían sin nombre en Azure DevOps boards
- La experiencia de usuario era confusa
- La funcionalidad principal de adjuntos estaba comprometida

**Solución**:
```typescript
// uploadAttachmentRest: Agregar comentario clarificador
// La URL devuelta por Azure DevOps ya incluye el parámetro fileName
// formato: https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{id}?fileName={name}

// ado_add_attachment: Usar URL completa devuelta por Azure DevOps
const attachment = await uploadAttachmentRest(filePath, fileName);
attachmentLinkUrl = attachment.url; // Usar la URL completa con ?fileName incluido
```

**Cambios Implementados**:
1. Modificar `uploadAttachmentRest` para agregar comentario sobre el formato de URL
2. Modificar `ado_add_attachment` para usar la URL completa devuelta por Azure DevOps
3. Declarar `attachmentLinkUrl` en el scope correcto para evitar errores de referencia
4. Agregar cláusula `else` para lanzar error cuando no se proporciona ni `filePath` ni `attachmentUrl`

**Resultado**:
- ✅ Los nombres de archivos ahora aparecen correctamente en Azure DevOps
- ✅ La experiencia de usuario es más clara
- ✅ La funcionalidad principal de adjuntos trabaja como se espera

### v2.4.5 (Commit 92b9db2)
- **Fix(env)**: Initialize currentProject with environment variable

#### 📝 Detalles
**Problema Crítico**: Race condition en llamadas REST cuando `currentProject` estaba vacío.

**Causa Raíz**:
```typescript
// Línea 320 (antes):
let currentProject: string = "";  // ❌ Inicializado como string vacío

// En autoConfigureFromEnv():
currentProject = project || "";  // Solo se llena cuando se llama
```

**Problema**:
- Las herramientas MCP podían ser llamadas antes de que `autoConfigureFromEnv()` completara
- Las llamadas REST en `uploadAttachmentRest()` fallaban cuando `currentProject` estaba vacío
- URL de construcción fallaba: `${baseUrl}//_apis/wit/attachments` (falta nombre del proyecto)

**Impacto**:
- Las herramientas MCP fallaban intermitentemente al inicio
- La experiencia de usuario era inconsistente
- Las operaciones con adjuntos fallaban con error de URL inválida

**Solución**:
```typescript
// Línea 91 (después):
let currentProject: string = ENV_ADO_PROJECT || "";  // ✅ Inicializar con variable de entorno

// Asegura que el nombre del proyecto está disponible desde la inicialización del módulo
// Elimina la condición de carrera con autoConfigureFromEnv()
```

**Cambios Implementados**:
1. Modificar inicialización de `currentProject` para usar `ENV_ADO_PROJECT || ""`
2. Asegurar disponibilidad del nombre del proyecto desde la carga del módulo
3. Eliminar condición de carrera con `autoConfigureFromEnv()`

**Resultado**:
- ✅ Las llamadas REST API funcionan correctamente con variables de entorno
- ✅ No más condiciones de carrera al inicio
- ✅ La experiencia de usuario es consistente desde el primer uso

## 📊 Impacto General

### Estabilidad
- **3 correcciones críticas** que mejoran la confiabilidad del MCP
- **Eliminación de bugs** que afectaban la experiencia de usuario principal
- **Mejoras en manejo de errores** para mensajes más claros

### Funcionalidad
- **Adjuntos**: Ahora funcionan correctamente con nombres apropiados
- **Configuración**: Eliminación de condiciones de carrera
- **Documentación**: Mejoras en claridad para usuarios

### Compatibilidad
- **100% compatible** con versiones anteriores
- **Sin breaking changes**
- **Migración transparente**: Solo actualizar la versión

## 🚀 Instalación

```bash
npm install @slorenzot/mcp-azure@2.4.5
```

## 🔄 Migración desde v2.4.1

Esta versión es **100% compatible** con v2.4.1. Simplemente actualiza:

```bash
npm update @slorenzot/mcp-azure
```

## ✅ Testing Realizado

- ✅ Adjuntos ahora aparecen con nombres correctos en Azure DevOps boards
- ✅ Eliminación de condiciones de carrera al inicio del servidor
- ✅ Manejo correcto de variables de entorno
- ✅ Compatibilidad verificada con configuraciones existentes
- ✅ Mensajes de error mejorados para usuarios

## 🐛 Problemas Resueltos

- ❌ Adjuntos sin nombres en Azure DevOps boards (v2.4.4)
- ❌ Condiciones de carrera al inicio (v2.4.5)
- ❌ Descripción confusa de parámetro name (v2.4.3)

## 🔮 Roadmap

Esta versión establece una base sólida para v2.6.0 que incluirá:
- Sistema de configuración jerárquico (.mcp.json → variables de entorno)
- Manejo de errores robusto con validaciones avanzadas
- Codificación URL inteligente para nombres de proyecto

---

*Serie de correcciones críticas que transformaron la estabilidad y funcionalidad de adjuntos en el MCP Azure DevOps.*