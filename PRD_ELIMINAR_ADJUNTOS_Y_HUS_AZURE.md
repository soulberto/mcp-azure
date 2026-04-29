# Product Requirements Document (PRD)
# Eliminación de Adjuntos e Historias de Usuario en Azure DevOps

## Document Overview
- **Version**: 1.0
- **Date**: 2026-04-29
- **Author**: Codex
- **Status**: Ready for Review
- **Product**: `@slorenzot/mcp-azure`

---

## 1. Resumen Ejecutivo

Este PRD define la incorporación de funciones de eliminación para:

1. **Adjuntos vinculados a Work Items**
2. **Historias de Usuario (HUs / User Stories) en Azure DevOps**

Hoy el servidor MCP permite crear, consultar, actualizar, comentar y adjuntar archivos, pero no ofrece una forma controlada de revertir estas acciones. Esto obliga a los usuarios a salir del flujo MCP y hacer la eliminación manualmente en Azure DevOps.

La propuesta agrega capacidades de eliminación seguras, auditables y coherentes con la arquitectura actual del proyecto.

---

## 2. Problema

### 2.1 Estado actual

El servidor ya soporta:
- `ado_create_work_item`
- `ado_update_work_item`
- `ado_upload_attachment`
- `ado_add_attachment`
- `ado_get_attachments`

Pero no soporta:
- Eliminar un adjunto ya vinculado a un Work Item
- Eliminar una HU directamente desde MCP

### 2.2 Impacto para el usuario

- Se generan errores operativos cuando se adjunta un archivo equivocado
- No existe forma simple de limpiar HUs creadas por error durante pruebas o automatizaciones
- El flujo queda incompleto: crear sí, eliminar no
- Se incrementa el uso manual de la UI de Azure DevOps para tareas correctivas

### 2.3 Oportunidad

Agregar eliminación cierra el ciclo CRUD de Work Items y mejora la confiabilidad del MCP en escenarios reales de operación, pruebas y automatización.

---

## 3. Objetivos

### 3.1 Objetivos de negocio

- Completar el ciclo de vida operativo de HUs y adjuntos desde MCP
- Reducir dependencia de la interfaz web de Azure DevOps
- Mejorar productividad en flujos de corrección y limpieza

### 3.2 Objetivos técnicos

- Mantener compatibilidad con la arquitectura actual de `src/index.ts`
- Reusar patrones existentes de validación, formato de respuesta y manejo de errores
- Minimizar riesgo de eliminación accidental mediante guardrails explícitos

---

## 4. Alcance

### 4.1 In scope

#### A. Eliminación de adjuntos de Work Items

Se agregará una herramienta MCP para **remover la relación de un adjunto** desde un Work Item.

Importante:
- En Azure DevOps Work Item Tracking, la eliminación propuesta será **desvincular el adjunto del Work Item**
- No se garantiza la eliminación física del binario subido al backend de Azure DevOps
- El comportamiento funcional esperado para el usuario será que el adjunto deje de aparecer en el Work Item

#### B. Eliminación de Historias de Usuario

Se agregará una herramienta MCP para eliminar HUs por ID.

Comportamiento esperado:
- **Por defecto:** borrado lógico (`soft delete`)
- **Opcional y resguardado:** destrucción permanente (`hard delete / destroy`)

### 4.2 Out of scope

- Restaurar Work Items eliminados
- Eliminar comentarios
- Eliminar adjuntos de Pull Requests
- Limpieza física garantizada de blobs de adjuntos en Azure DevOps
- Eliminación masiva en esta primera versión

---

## 5. Supuestos y Restricciones

### 5.1 Supuestos

- El PAT configurado tendrá permisos de **Work Items: Read & Write**
- Los usuarios conocen el `workItemId` objetivo antes de eliminar
- Los usuarios podrán obtener el `attachmentUrl` desde `ado_get_attachments`

### 5.2 Restricciones técnicas

- La eliminación de adjuntos se implementará sobre la **relación** del Work Item (`/relations/{index}`), no sobre una API de borrado físico del attachment de WIT
- La eliminación de un adjunto modifica la revisión del Work Item, por lo que puede sufrir los mismos conflictos de concurrencia ya detectados en `ado_add_attachment`
- `deleteWorkItem(..., destroy?: boolean)` existe en el SDK instalado y será la base para la eliminación de HUs

---

## 6. Solución Propuesta

### 6.1 Nuevas herramientas MCP

### Tool 1: `ado_delete_attachment`

**Propósito**: eliminar un adjunto de un Work Item removiendo su relación.

**Entradas propuestas**:

```typescript
{
  workItemId: z.number().describe("ID del Work Item"),
  attachmentUrl: z.string().optional().describe("URL exacta del adjunto a eliminar"),
  attachmentName: z.string().optional().describe("Nombre del adjunto a eliminar si no se conoce la URL"),
  comment: z.string().optional().describe("Motivo o contexto de la eliminación para logging/respuesta")
}
```

**Reglas funcionales**:
- Debe recibirse `attachmentUrl` o `attachmentName`
- Si se usa `attachmentName` y existen múltiples coincidencias, la operación debe fallar con mensaje claro
- Si el adjunto no existe en el Work Item, se devuelve error funcional entendible
- La eliminación se realiza con PATCH `remove` sobre la relación encontrada

**Resultado esperado**:
- El adjunto ya no aparece en `ado_get_attachments`
- La respuesta informa nombre, URL y Work Item afectado

### Tool 2: `ado_delete_work_item`

**Propósito**: eliminar una HU en Azure DevOps de forma segura.

**Entradas propuestas**:

```typescript
{
  id: z.number().describe("ID del Work Item a eliminar"),
  destroy: z.boolean().optional().describe("Si es true, destruye permanentemente el Work Item"),
  confirm: z.boolean().describe("Confirmación explícita para ejecutar la eliminación"),
  expectedType: z.string().optional().describe("Tipo esperado del Work Item, ej. 'User Story'")
}
```

**Reglas funcionales**:
- `confirm` debe ser obligatorio y debe venir en `true`
- `destroy` debe ser opcional y `false` por defecto
- Antes de eliminar, el sistema debe consultar el Work Item para validar que existe
- Si se envía `expectedType`, el sistema debe validar el tipo antes de borrar
- Si el Work Item no es una HU y el caso de uso del usuario era eliminar HUs, la respuesta debe advertirlo claramente

**Resultado esperado**:
- En modo por defecto, la HU queda eliminada de forma lógica
- En modo `destroy`, la HU se elimina permanentemente
- La respuesta indica el tipo, título, ID y modo de eliminación aplicado

---

## 7. Diseño Funcional

### 7.1 Flujo de eliminación de adjuntos

1. Validar conexión y proyecto
2. Obtener Work Item con `expand: Relations`
3. Filtrar relaciones `AttachedFile`
4. Resolver la coincidencia por `attachmentUrl` o `attachmentName`
5. Construir `JsonPatchOperation` con `op: Remove`
6. Actualizar Work Item
7. Devolver confirmación

### 7.2 Flujo de eliminación de HU

1. Validar conexión y proyecto
2. Validar `confirm === true`
3. Consultar el Work Item por ID
4. Validar tipo si aplica
5. Ejecutar `deleteWorkItem(id, currentProject, destroy)`
6. Devolver resultado resumido y seguro

---

## 8. Diseño Técnico

### 8.1 Cambios en código

Se agregará implementación en `src/index.ts`, manteniendo la arquitectura actual de archivo único.

Áreas esperadas de cambio:
- Helpers para resolver adjuntos por relación
- Reutilización o generalización del manejo de concurrencia actual de attachments
- Nuevas tools MCP registradas en la sección de Work Items / Attachments
- Actualización de README con nuevas herramientas

### 8.2 Implementación de eliminación de adjuntos

La lógica base será:

```typescript
const workItem = await api.getWorkItem(
  workItemId,
  undefined,
  undefined,
  witInterfaces.WorkItemExpand.Relations
);

const relationIndex = workItem.relations?.findIndex(/* match por URL o nombre */);

const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
  {
    op: VSSInterfaces.Operation.Remove,
    path: `/relations/${relationIndex}`
  }
];

await api.updateWorkItem(null, patchDocument, workItemId);
```

### 8.3 Implementación de eliminación de HU

La lógica base será:

```typescript
const existing = await api.getWorkItem(id, undefined, undefined, witInterfaces.WorkItemExpand.Fields);

if (!confirm) {
  throw new Error("Debe confirmar explícitamente la eliminación con confirm=true");
}

const result = await api.deleteWorkItem(id, currentProject, destroy ?? false);
```

### 8.4 Concurrencia

La eliminación de adjuntos modifica relaciones del Work Item y por tanto incrementa su revisión. Para evitar errores tipo `TF26071`, la solución debe:

- Reusar la cola por `workItemId` ya introducida para adjuntos
- Reintentar automáticamente cuando el error sea de concurrencia
- Reconsultar el Work Item antes del nuevo intento

Recomendación:
- Generalizar `AttachmentQueueManager` a un gestor de mutaciones por Work Item, útil para `add_attachment` y `delete_attachment`

---

## 9. UX y Mensajes de Respuesta

### 9.1 Respuesta exitosa para adjunto

```text
Adjunto eliminado exitosamente del Work Item #12345
- Nombre: evidencia.pdf
- URL: https://dev.azure.com/.../attachments/abc123
```

### 9.2 Respuesta exitosa para HU

```text
Work Item eliminado exitosamente
- ID: 12345
- Tipo: User Story
- Título: Implementar login con OAuth
- Modo: soft delete
```

### 9.3 Errores funcionales esperados

- `No se encontró el adjunto indicado en el Work Item`
- `Se encontraron múltiples adjuntos con el mismo nombre; use attachmentUrl`
- `Debe confirmar explícitamente la eliminación con confirm=true`
- `El Work Item #12345 no corresponde al tipo esperado: User Story`
- `No se puede destruir permanentemente sin autorización explícita`

---

## 10. Seguridad y Guardrails

### 10.1 Para `ado_delete_work_item`

- `confirm` obligatorio
- `destroy` desactivado por defecto
- Mensajes explícitos indicando irreversibilidad cuando `destroy=true`
- Validación previa de existencia y tipo

### 10.2 Para `ado_delete_attachment`

- Preferencia por `attachmentUrl` como identificador único
- Rechazo de ambigüedad por nombre duplicado
- Logging interno con `workItemId` y adjunto removido

---

## 11. Cambios en Documentación

Se deberá actualizar `README.md` para incluir:

### Nueva sección o filas en tablas

- `ado_delete_attachment` | Elimina un adjunto de un Work Item
- `ado_delete_work_item` | Elimina un Work Item/HU en Azure DevOps

### Ejemplos de uso

```json
{
  "workItemId": 12345,
  "attachmentUrl": "https://dev.azure.com/org/proj/_apis/wit/attachments/abc123",
  "comment": "Adjunto agregado por error"
}
```

```json
{
  "id": 12345,
  "confirm": true,
  "destroy": false,
  "expectedType": "User Story"
}
```

---

## 12. Criterios de Aceptación

### 12.1 Adjuntos

- El usuario puede eliminar un adjunto existente desde MCP usando `attachmentUrl`
- Si el adjunto no existe, recibe un error claro
- Si hay concurrencia sobre el mismo Work Item, la operación reintenta o se serializa correctamente
- Tras la operación, `ado_get_attachments` ya no lista el adjunto removido

### 12.2 HUs

- El usuario puede eliminar una HU por ID con confirmación explícita
- La eliminación por defecto no destruye permanentemente el Work Item
- Si `destroy=true`, el sistema deja clara la irreversibilidad
- Si el Work Item no existe, la respuesta es entendible
- Si `expectedType` no coincide, la herramienta falla de forma segura

---

## 13. Casos de Prueba

### 13.1 Casos felices

1. Eliminar adjunto existente por URL
2. Eliminar adjunto existente por nombre único
3. Eliminar HU existente con `confirm=true`
4. Eliminar HU con `destroy=true`

### 13.2 Casos de error

1. Intentar eliminar adjunto inexistente
2. Intentar eliminar adjunto por nombre duplicado
3. Intentar eliminar HU con `confirm=false`
4. Intentar eliminar HU inexistente
5. Intentar eliminar HU con `expectedType` incorrecto
6. Simular conflicto de concurrencia al remover adjuntos del mismo Work Item

---

## 14. Riesgos

### Riesgo 1: Eliminación accidental

**Mitigación**:
- `confirm` obligatorio
- `destroy` apagado por defecto
- Validación previa del tipo y del Work Item

### Riesgo 2: Ambigüedad de adjuntos por nombre

**Mitigación**:
- Favorecer `attachmentUrl`
- Fallar si el nombre no es único

### Riesgo 3: Conflictos de revisión

**Mitigación**:
- Reusar cola por Work Item
- Reintentos con backoff

### Riesgo 4: Diferencia entre “desvincular” y “borrar físicamente”

**Mitigación**:
- Documentarlo claramente en README y descripción de la tool
- No prometer borrado físico del binario

---

## 15. Fases Recomendadas

### Fase 1

- Implementar `ado_delete_attachment`
- Reusar manejo de concurrencia
- Documentar limitación de unlink vs delete físico

### Fase 2

- Implementar `ado_delete_work_item` con `soft delete`
- Agregar `destroy` resguardado

### Fase 3

- Refinar mensajes, ejemplos y validaciones de tipo
- Considerar futura capacidad de restore o borrado masivo

---

## 16. Recomendación Final

La funcionalidad debe implementarse con enfoque de seguridad por defecto:

- **Adjuntos**: eliminar = remover relación del Work Item
- **HUs**: eliminar = `soft delete` por defecto
- **Operaciones irreversibles**: solo con confirmación explícita

Esto mantiene consistencia con Azure DevOps, reduce riesgo operacional y completa una capacidad muy esperada del servidor MCP.
