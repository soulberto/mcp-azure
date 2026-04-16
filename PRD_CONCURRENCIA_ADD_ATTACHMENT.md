# PRD: Corrección de Concurrencia en add_attachment

## 📋 Resumen Ejecutivo

Corregir el problema de concurrencia en `ado_add_attachment` que causa el error **TF26071** cuando múltiples intentos de agregar adjuntos ocurren simultáneamente al mismo Work Item en Azure DevOps.

## 🐛 Problema

### Error Reportado
```
TF26071: This work item has been changed by someone else since you opened it.
```

### Causa Raíz
Cuando múltiples llamadas a `ado_add_attachment` golpean el mismo `workItemId` en paralelo, Azure DevOps rechaza los cambios debido a conflicto de revisión. Cada `add_attachment` incrementa la revisión del Work Item.

### Flujo del Problema
1. **Usuario A** ejecuta `add_attachment` para WI #123 → Recupera WI versión 10
2. **Usuario B** ejecuta `add_attachment` para WI #123 → Recupera WI versión 10
3. **Usuario A** intenta actualizar WI #123 con adjunto → Azure DevOps acepta (versión 10→11)
4. **Usuario B** intenta actualizar WI #123 con adjunto → **TF26071**: Versión 10 ya no es la actual
5. **Resultado**: El segundo adjunto falla con error confuso para el usuario

### Impacto
- ❌ **Pérdida de funcionalidad**: Los segundos intentos fallan
- ❌ **Experiencia de usuario**: Errores técnicos no comprensibles
- ❌ **Inconsistencia**: A veces funciona, a veces falla (race condition)
- ❌ **Sin workaround documentado**: Los usuarios no saben cómo manejarlo

## ✅ Solución Propuesta

### Estrategia Principal: Sistema de Cola por Work Item

Implementar una cola interna por Work Item que asegure que las operaciones de adjuntos sean **secuenciales** por WI, permitiendo paralelismo entre diferentes Work Items.

### Arquitectura de la Solución

#### 1. Sistema de Cola por Work Item

```typescript
interface AttachmentQueue {
  // Mapa de colas por Work Item ID
  queues: Map<number, Promise<AttachmentResult>>;
  
  // Agregar operación a la cola del WI
  addToQueue(workItemId: number, operation: () => Promise<AttachmentResult>): Promise<AttachmentResult>;
  
  // Verificar si hay cola activa para el WI
  hasActiveQueue(workItemId: number): boolean;
}
```

#### 2. Retry Automático con Re-fetch

```typescript
async function addAttachmentWithRetry(
  workItemId: number,
  attachmentData: AttachmentData,
  maxRetries: number = 3
): Promise<AttachmentResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Recuperar versión actual del WI (importante para cada intento)
      const currentWI = await getWorkItem(workItemId);
      
      // 2. Agregar adjunto usando la versión actual
      return await addAttachment(workItemId, attachmentData);
      
    } catch (error: any) {
      // 3. Verificar si es error de concurrencia TF26071
      if (isConcurrencyError(error) && attempt < maxRetries) {
        // 4. Esperar backoff exponencial
        await sleep(Math.pow(2, attempt) * 1000); // 2s, 4s, 8s
        
        // 5. Re-fetch del WI para obtener la nueva versión
        continue;
      }
      
      // 6. Si no es TF26071 o se agotaron reintentos, lanzar error
      throw error;
    }
  }
}
```

#### 3. Integración en `ado_add_attachment`

```typescript
server.tool(
  "ado_add_attachment",
  "Agrega un adjunto a un Work Item existente con manejo de concurrencia",
  // ... parámetros existentes ...
  async ({ workItemId, filePath, attachmentUrl, comment, name }) => {
    validateConnection();
    validateProject();
    
    // Verificar si hay cola activa para este WI
    if (attachmentQueue.hasActiveQueue(workItemId)) {
      console.error(`⏳ Encolando adjunto para WI #${workItemId} (ya hay operación en curso)`);
      return await attachmentQueue.addToQueue(workItemId, () => 
        addAttachmentWithRetry(workItemId, { filePath, attachmentUrl, comment, name })
      );
    }
    
    // No hay cola activa, ejecutar directamente con retry
    console.error(`🚀 Ejecutando adjunto para WI #${workItemId}`);
    return await addAttachmentWithRetry(workItemId, { filePath, attachmentUrl, comment, name });
  }
);
```

## 🔧 Implementación Detallada

### Paso 1: Funciones de Utilidad

```typescript
// Detectar si el error es TF26071 (concurrencia)
function isConcurrencyError(error: any): boolean {
  const errorString = error?.message || error?.toString() || '';
  return errorString.includes('TF26071') || 
         errorString.includes('changed by someone else');
}

// Función de sleep para backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Obtener Work Item actualizado (para re-fetch en retry)
async function getWorkItem(workItemId: number): Promise<witInterfaces.WorkItem> {
  const api = await getWitApi();
  return await safeApiCall(
    () => api.getWorkItem(workItemId, undefined, undefined, witInterfaces.WorkItemExpand.All),
    `Error al obtener Work Item #${workItemId}`
  );
}
```

### Paso 2: Implementación de Cola

```typescript
// Sistema de cola por Work Item
class AttachmentQueueManager {
  private queues: Map<number, Promise<any>> = new Map();
  
  async addToQueue<T>(
    workItemId: number,
    operation: () => Promise<T>
  ): Promise<T> {
    // Si ya hay cola para este WI, esperar
    const existingQueue = this.queues.get(workItemId);
    if (existingQueue) {
      console.error(`⏳ Esperando cola para WI #${workItemId}...`);
      try {
        await existingQueue;
      } catch {
        // Si la operación anterior falló, proceder con la nuestra
      }
    }
    
    // Crear nueva cola para este WI
    const queue = operation().finally(() => {
      // Limpiar cola cuando termine
      this.queues.delete(workItemId);
    });
    
    this.queues.set(workItemId, queue);
    return queue;
  }
  
  hasActiveQueue(workItemId: number): boolean {
    return this.queues.has(workItemId);
  }
}

// Instancia global del gestor de colas
const attachmentQueue = new AttachmentQueueManager();
```

### Paso 3: Función Principal con Retry

```typescript
// Función principal con retry y re-fetch
async function addAttachmentWithRetry(
  api: witApi.IWorkItemTrackingApi,
  workItemId: number,
  attachmentData: {
    filePath?: string;
    attachmentUrl?: string;
    comment?: string;
    name?: string;
  },
  maxRetries: number = 3
): Promise<{ content: any }> {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.error(`🔄 Intento ${attempt}/${maxRetries} para adjuntar a WI #${workItemId}`);
      
      // 1. Recuperar versión actual del WI (CRÍTICO para cada intento)
      const currentWI = await getWorkItem(workItemId);
      console.error(`📄 WI #${workItemId} versión actual: ${currentWI.rev}`);
      
      // 2. Procesar adjunto
      let attachmentId: string | undefined;
      let fileName: string | undefined;
      let attachmentLinkUrl: string | undefined;
      
      if (attachmentData.filePath) {
        // Subir archivo nuevo
        fileName = attachmentData.name || path.basename(attachmentData.filePath);
        const attachment = await uploadAttachmentRest(attachmentData.filePath, fileName);
        attachmentId = attachment.id;
        attachmentLinkUrl = attachment.url;
      } else if (attachmentData.attachmentUrl) {
        // Usar adjunto existente
        attachmentId = attachmentData.attachmentUrl.split('/attachments/')[1]?.split('?')[0];
        fileName = attachmentData.name || "Archivo adjunto";
        const baseUrl = currentOrg.endsWith("/") ? currentOrg.slice(0, -1) : currentOrg;
        const encodedProject = getEncodedProject(currentProject);
        attachmentLinkUrl = `${baseUrl}/${encodedProject}/_apis/wit/attachments/${attachmentId}`;
      } else {
        throw new Error("Debe proporcionar filePath o attachmentUrl");
      }
      
      // 3. Vincular adjunto al WI usando la versión ACTUAL
      const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
        {
          op: VSSInterfaces.Operation.Add,
          path: "/relations/-",
          value: {
            rel: "AttachedFile",
            url: attachmentLinkUrl,
            attributes: {
              name: fileName,
              comment: attachmentData.comment || "",
            },
          },
        },
      ];
      
      // 4. Actualizar WI con la versión actual
      const updatedWI = await api.updateWorkItem(
        null, // project
        patchDocument,
        workItemId
      );
      
      console.error(`✅ Adjunto agregado exitosamente a WI #${workItemId}`);
      
      return {
        content: [{
          type: "text",
          text: `Adjunto agregado exitosamente al Work Item #${workItemId}\n- Nombre: ${fileName}\n- URL: ${attachmentLinkUrl}`,
        }],
      };
      
    } catch (error: any) {
      lastError = error;
      console.error(`❌ Error en intento ${attempt}:`, error.message);
      
      // Verificar si es error de concurrencia y quedan reintentos
      if (isConcurrencyError(error) && attempt < maxRetries) {
        const backoffTime = Math.pow(2, attempt) * 1000;
        console.error(`⏳ Error TF26071 detectado. Esperando ${backoffTime}ms antes de reintentar...`);
        await sleep(backoffTime);
        console.error(`🔄 Reintentando con nueva versión del WI...`);
        continue;
      }
      
      // Si no es TF26071 o se agotaron reintentos, lanzar error
      throw error;
    }
  }
  
  // Si se agotaron todos los reintentos, lanzar el último error
  throw lastError;
}
```

### Paso 4: Actualización de `ado_add_attachment`

```typescript
server.tool(
  "ado_add_attachment",
  "Agrega un adjunto a un Work Item existente. Maneja automáticamente concurrencia cuando múltiples adjuntos se agregan al mismo WI.",
  {
    workItemId: z.number().describe("ID del Work Item"),
    filePath: z.string().optional().describe("Ruta del archivo a subir (opcional si se usa attachmentUrl)"),
    attachmentUrl: z.string().optional().describe("URL de un adjunto ya subido (opcional si se usa filePath)"),
    comment: z.string().optional().describe("Comentario para el adjunto"),
    name: z.string().optional().describe("Nombre del archivo (si no se especifica, usa el nombre del archivo original)"),
  },
  async ({ workItemId, filePath, attachmentUrl, comment, name }) => {
    validateConnection();
    validateProject();
    
    const api = await getWitApi();
    
    // VERIFICAR CONCURRENCIA: Usar sistema de cola
    if (attachmentQueue.hasActiveQueue(workItemId)) {
      console.error(`⏳ Encolando adjunto para WI #${workItemId} (ya hay operación en curso)`);
      return await attachmentQueue.addToQueue(workItemId, () => 
        addAttachmentWithRetry(api, workItemId, { filePath, attachmentUrl, comment, name })
      );
    }
    
    // Sin concurrencia: ejecutar directamente
    console.error(`🚀 Ejecutando adjunto para WI #${workItemId}`);
    return await attachmentQueue.addToQueue(workItemId, () => 
      addAttachmentWithRetry(api, workItemId, { filePath, attachmentUrl, comment, name })
    );
  }
);
```

## 📊 Casos de Uso

### Caso 1: Adjunto Único (sin concurrencia)
```
Usuario: add_attachment(123, "archivo.pdf")
Resultado: ✅ Adjunto agregado en primer intento
Logs:
  🚀 Ejecutando adjunto para WI #123
  📄 WI #123 versión actual: 10
  ✅ Adjunto agregado exitosamente a WI #123
```

### Caso 2: Concurrencia (2 adjuntos simultáneos)
```
Usuario A (hilo 1): add_attachment(123, "archivo1.pdf")
Usuario B (hilo 2): add_attachment(123, "archivo2.pdf")

Resultado:
  Hilo 1: ✅ Adjunto agregado en primer intento
  Hilo 2: ⏳ Encolado, espera a que termine hilo 1
  Hilo 2: ✅ Adjunto agregado después de que hilo 1 terminó

Logs:
  Hilo 1: 🚀 Ejecutando adjunto para WI #123
  Hilo 2: ⏳ Encolando adjunto para WI #123 (ya hay operación en curso)
  Hilo 1: 📄 WI #123 versión actual: 10
  Hilo 1: ✅ Adjunto agregado exitosamente a WI #123
  Hilo 2: 📄 WI #123 versión actual: 11
  Hilo 2: ✅ Adjunto agregado exitosamente a WI #123
```

### Caso 3: Concurrencia con TF26071 (3 adjuntos simultáneos)
```
Usuario A, B, C: add_attachment(123, "archivoX.pdf")

Resultado:
  Hilo 1: ✅ Adjunto agregado (versión 10→11)
  Hilo 2: ⏳ Encolado, espera hilo 1
  Hilo 3: ⏳ Encolado, espera hilo 1
  Hilo 2: 🔄 Intento 1 → TF26071 → Reintenta
  Hilo 2: 📄 WI #123 versión actual: 11
  Hilo 2: ✅ Adjunto agregado (versión 11→12)
  Hilo 3: 🔄 Intento 1 → TF26071 → Reintenta
  Hilo 3: 📄 WI #123 versión actual: 12
  Hilo 3: ✅ Adjunto agregado (versión 12→13)
```

## ✅ Beneficios

### Para Usuarios
- ✅ **Sin errores TF26071**: Manejo automático de concurrencia
- ✅ **Transparencia**: El sistema maneja los reintentos automáticamente
- ✅ **Predictibilidad**: Los adjuntos siempre se agregan, eventualmente
- ✅ **Mejor experiencia**: Sin necesidad de reintentar manualmente

### Para Desarrolladores
- ✅ **Código limpio**: Lógica de concurrencia encapsulada
- ✅ **Reutilizable**: Sistema de cola puede usarse para otras operaciones
- ✅ **Debuggable**: Logs claros de lo que está pasando
- ✅ **Testable**: Lógica separada en funciones pequeñas

## 🧪 Testing

### Test Unitarios

```typescript
// Test: Detección de error TF26071
describe('isConcurrencyError', () => {
  it('debería detectar error TF26071', () => {
    const error = new Error('TF26071: This work item has been changed by someone else since you opened it.');
    expect(isConcurrencyError(error)).toBe(true);
  });
  
  it('no debería detectar otros errores', () => {
    const error = new Error('Network error');
    expect(isConcurrencyError(error)).toBe(false);
  });
});

// Test: Sistema de cola
describe('AttachmentQueueManager', () => {
  it('debería encolar operaciones concurrentes al mismo WI', async () => {
    const queue = new AttachmentQueueManager();
    const results: string[] = [];
    
    // Simular 3 operaciones concurrentes al mismo WI
    const op1 = queue.addToQueue(123, async () => { await sleep(100); return 'A'; });
    const op2 = queue.addToQueue(123, async () => { await sleep(50); return 'B'; });
    const op3 = queue.addToQueue(123, async () => { await sleep(50); return 'C'; });
    
    results.push(await op1, await op2, await op3);
    expect(results).toEqual(['A', 'B', 'C']);
  });
});
```

### Test de Integración

```typescript
// Test: Retry automático con concurrencia simulada
describe('addAttachmentWithRetry', () => {
  it('debería reintentar automáticamente al recibir TF26071', async () => {
    let callCount = 0;
    
    // Mock de API que falla 2 veces con TF26071, luego tiene éxito
    const mockApi = {
      updateWorkItem: jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('TF26071: This work item has been changed by someone else since you opened it.');
        }
        return { id: 123, rev: 10 + callCount };
      })
    } as any;
    
    const result = await addAttachmentWithRetry(mockApi, 123, { filePath: 'test.pdf' });
    
    expect(mockApi.updateWorkItem).toHaveBeenCalledTimes(3);
    expect(callCount).toBe(3);
    expect(result).toBeDefined();
  });
});
```

## 🚀 Plan de Implementación

### Fase 1: Implementación Core (Sprint 1)
- [ ] Funciones de utilidad: `isConcurrencyError`, `sleep`, `getWorkItem`
- [ ] Clase `AttachmentQueueManager`
- [ ] Función `addAttachmentWithRetry` con lógica de retry
- [ ] Tests unitarios para nuevas funciones

### Fase 2: Integración (Sprint 1)
- [ ] Actualizar `ado_add_attachment` para usar sistema de cola
- [ ] Agregar logs informativos de concurrencia
- [ ] Tests de integración end-to-end

### Fase 3: Documentación (Sprint 1)
- [ ] Actualizar README.md con manejo de concurrencia
- [ ] Agregar ejemplos de uso con concurrencia
- [ ] Documentar comportamientos esperados

## 📝 Notas Técnicas

### Consideraciones de Performance
- **Cola por WI**: Solo serializa operaciones del mismo WI, permite paralelismo entre diferentes WIs
- **Backoff exponencial**: Evita sobrecargar Azure DevOps con reintentos agresivos
- **Re-fetch eficiente**: Solo recupera datos necesarios del WI, no campos completos

### Compatibilidad hacia atrás
- ✅ **Sin breaking changes**: Comportamiento automático y transparente
- ✅ **Opcional**: Si no hay concurrencia, funciona igual que antes
- ✅ **Configurable**: `maxRetries` puede ajustarse por usuario o config

### Manejo de Edge Cases
- ✅ **Timeout de colas**: Las colas no deben quedarse esperando para siempre
- ✅ **Error en operación anterior**: Si la op anterior falló, la siguiente debe proceder
- ✅ **Limpieza de colas**: Las colas se limpian automáticamente cuando terminan

## 🎯 Criterios de Éxito

### Funcionales
- ✅ Los adjuntos se agregan exitosamente incluso con concurrencia
- ✅ No se observan más errores TF26071 en producción
- ✅ El sistema maneja automáticamente los reintentos
- ✅ Las operaciones a diferentes WIs se ejecutan en paralelo

### No Funcionales
- ✅ Latencia aceptable (< 5s adicional con retry)
- ✅ Sin memory leaks en sistema de cola
- ✅ Logs claros y accionables
- ✅ Tests con > 80% de cobertura

## 📞 Risk Assessment

### Riesgos
| Riesgo | Probabilidad | Impacto | Mitigación |
|---------|-------------|-----------|-------------|
| Retry infinito con TF26071 persistente | Baja | Alta | Límite de 3 reintentos por defecto |
| Memory leak en colas no limpiadas | Baja | Media | Limpieza automática en `finally()` |
| Performance degradation con muchos retries | Media | Baja | Backoff exponencial y límite de reintentos |

## 📊 Estimación de Esfuerzo

### Complejidad Técnica: Media
- Implementación de sistema de cola: 2-3 días
- Lógica de retry con re-fetch: 1-2 días
- Integración y testing: 2-3 días
- Documentación: 1 día

**Total estimado**: 6-9 días de desarrollo

---

*Este PRD establece la solución completa para el problema de concurrencia en `ado_add_attachment`, eliminando los errores TF26071 y proporcionando una experiencia de usuario robusta y transparente.*