#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as azdev from "azure-devops-node-api";
import * as witApi from "azure-devops-node-api/WorkItemTrackingApi";
import * as witInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import * as coreApi from "azure-devops-node-api/CoreApi";
import * as VSSInterfaces from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import * as gitApi from "azure-devops-node-api/GitApi";
import * as gitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// ============================================
// VARIABLES DE ENTORNO
// ============================================
const ENV_ADO_ORG = process.env.AZURE_DEVOPS_ORG || process.env.ADO_ORG;
const ENV_ADO_PAT = process.env.AZURE_DEVOPS_PAT || process.env.ADO_PAT;
const ENV_ADO_PROJECT = process.env.AZURE_DEVOPS_PROJECT || process.env.ADO_PROJECT;

// Variable para almacenar el PAT actual (para llamadas REST directas)
let currentPat: string = ENV_ADO_PAT || "";
let currentOrg: string = ENV_ADO_ORG || "";

// Helper para subir attachment via REST API
async function uploadAttachmentRest(
  filePath: string,
  fileName: string
): Promise<{ url: string; id: string; name: string }> {
  const fileContent = fs.readFileSync(filePath);

  // Construir URL del API - asegurar que no haya doble slash
  const baseUrl = currentOrg.endsWith("/") ? currentOrg.slice(0, -1) : currentOrg;
  const encodedProject = encodeURIComponent(currentProject);
  const encodedFileName = encodeURIComponent(fileName);
  const fullUrl = `${baseUrl}/${encodedProject}/_apis/wit/attachments?fileName=${encodedFileName}&api-version=7.0`;

  const urlObj = new URL(fullUrl);

  const options: https.RequestOptions = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": fileContent.length,
      "Authorization": `Basic ${Buffer.from(`:${currentPat}`).toString("base64")}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(data);
            resolve({ url: result.url, id: result.id, name: fileName });
          } catch (e) {
            reject(new Error(`Error parsing response: ${data}`));
          }
        } else {
          reject(new Error(`Error uploading attachment: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(new Error(`Request error: ${e.message}`)));
    req.write(fileContent);
    req.end();
  });
}

// Crear el servidor MCP
const server = new McpServer({
  name: "mcp-azure",
  version: "1.0.0",
});

// Configuración de conexión
let connection: azdev.WebApi | null = null;
let workItemTrackingApi: witApi.IWorkItemTrackingApi | null = null;
let coreApiClient: coreApi.ICoreApi | null = null;
let gitApiClient: gitApi.IGitApi | null = null;
let currentProject: string = "";

// Helper para obtener la conexión
async function getConnection(): Promise<azdev.WebApi> {
  if (!connection) {
    throw new Error(
      `No hay conexión configurada con Azure DevOps.

Configura las siguientes variables de entorno:
  - AZURE_DEVOPS_ORG (o ADO_ORG): URL de la organización (ej: https://dev.azure.com/mi-org)
  - AZURE_DEVOPS_PAT (o ADO_PAT): Personal Access Token
  - AZURE_DEVOPS_PROJECT (o ADO_PROJECT): Nombre del proyecto (opcional)

 Para obtener un PAT:
  1. Ve a tu organización de Azure DevOps
  2. Haz clic en tu avatar > Personal Access Tokens
  3. Crea un nuevo token con permisos de:
     - Work Items (Read & Write)
     - Code (Read & Write)

Ejemplo de configuración MCP:
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@slorenzot/mcp-azure"],
      "env": {
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/tu-organizacion",
        "AZURE_DEVOPS_PAT": "tu-pat-aqui",
        "AZURE_DEVOPS_PROJECT": "tu-proyecto"
      }
    }
  }
}`
    );
  }
  return connection;
}

// Helper para obtener Work Item Tracking API
async function getWitApi(): Promise<witApi.IWorkItemTrackingApi> {
  if (!workItemTrackingApi) {
    const conn = await getConnection();
    workItemTrackingApi = await conn.getWorkItemTrackingApi();
  }
  return workItemTrackingApi;
}

// Helper para obtener Core API
async function getCoreApi(): Promise<coreApi.ICoreApi> {
  if (!coreApiClient) {
    const conn = await getConnection();
    coreApiClient = await conn.getCoreApi();
  }
  return coreApiClient;
}

// Helper para obtener Git API
async function getGitApi(): Promise<gitApi.IGitApi> {
  if (!gitApiClient) {
    const conn = await getConnection();
    gitApiClient = await conn.getGitApi();
  }
  return gitApiClient;
}

// Helper para formatear Work Item
function formatWorkItem(workItem: witInterfaces.WorkItem): string {
  const fields = workItem.fields || {};
  return JSON.stringify(
    {
      id: workItem.id,
      rev: workItem.rev,
      url: workItem.url,
      fields: {
        title: fields["System.Title"],
        state: fields["System.State"],
        workItemType: fields["System.WorkItemType"],
        assignedTo: fields["System.AssignedTo"]?.displayName,
        areaPath: fields["System.AreaPath"],
        iterationPath: fields["System.IterationPath"],
        description: fields["System.Description"],
        tags: fields["System.Tags"],
        createdDate: fields["System.CreatedDate"],
        changedDate: fields["System.ChangedDate"],
      },
    },
    null,
    2
  );
}

// Helper para formatear lista de Work Items
function formatWorkItemList(
  workItems: witInterfaces.WorkItemReference[]
): string {
  return workItems
    .map((wi) => `ID: ${wi.id} - URL: ${wi.url}`)
    .join("\n");
}

// Helper para formatear bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

// Helper para obtener etiqueta de voto
function getVoteLabel(vote?: number): string {
  if (!vote) return "No vote";
  switch (vote) {
    case 10: return "Approved";
    case 5: return "Approved with suggestions";
    case 0: return "No vote";
    case -5: return "Waiting for author";
    case -10: return "Rejected";
    default: return `${vote}`;
  }
}

// Helper para formatear repositorio
function formatRepository(repo: gitInterfaces.GitRepository): string {
  return JSON.stringify({
    id: repo.id,
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    size: repo.size ? formatBytes(repo.size) : undefined,
    isFork: repo.isFork,
    isDisabled: repo.isDisabled,
    project: repo.project?.name,
    remoteUrl: repo.remoteUrl,
    sshUrl: repo.sshUrl,
    webUrl: repo.webUrl,
    parentRepository: repo.parentRepository?.name
  }, null, 2);
}

// Helper para formatear lista de repositorios
function formatRepositoryList(repos: gitInterfaces.GitRepository[]): string {
  return JSON.stringify(repos.map(r => ({
    id: r.id,
    name: r.name,
    defaultBranch: r.defaultBranch,
    size: r.size ? formatBytes(r.size) : undefined,
    isFork: r.isFork,
    remoteUrl: r.remoteUrl,
    webUrl: r.webUrl
  })), null, 2);
}

// Helper para formatear lista de branches
function formatBranchList(refs: gitInterfaces.GitRef[]): string {
  return JSON.stringify(refs.map(r => ({
    name: r.name?.replace("refs/heads/", ""),
    commit: r.objectId,
    isLocked: r.isLocked,
    lockedBy: r.isLockedBy?.displayName,
    statuses: r.statuses?.map(s => ({
      state: s.state,
      description: s.description
    }))
  })), null, 2);
}

// Helper para formatear Pull Request
function formatPullRequest(pr: gitInterfaces.GitPullRequest): string {
  return JSON.stringify({
    pullRequestId: pr.pullRequestId,
    title: pr.title,
    description: pr.description,
    status: gitInterfaces.PullRequestStatus[pr.status || 0],
    repository: {
      id: pr.repository?.id,
      name: pr.repository?.name
    },
    createdBy: pr.createdBy?.displayName,
    createdDate: pr.creationDate,
    closedBy: pr.closedBy?.displayName,
    closedDate: pr.closedDate,
    sourceRefName: pr.sourceRefName,
    targetRefName: pr.targetRefName,
    isDraft: pr.isDraft,
    mergeStatus: gitInterfaces.PullRequestAsyncStatus[pr.mergeStatus || 0],
    mergeStatusMessage: pr.mergeFailureMessage,
    reviewers: pr.reviewers?.map(r => ({
      displayName: r.displayName,
      vote: r.vote,
      voteLabel: getVoteLabel(r.vote),
      isRequired: r.isRequired
    })),
    labels: pr.labels?.map(l => l.name),
    completionOptions: pr.completionOptions,
    commitsCount: pr.commits?.length,
    workItemsCount: pr.workItemRefs?.length,
    url: pr.url,
    webUrl: `${pr.repository?.webUrl}/pullrequest/${pr.pullRequestId}`
  }, null, 2);
}

// Helper para formatear lista de Pull Requests
function formatPullRequestList(prs: gitInterfaces.GitPullRequest[]): string {
  return JSON.stringify(prs.map(pr => ({
    pullRequestId: pr.pullRequestId,
    title: pr.title,
    status: gitInterfaces.PullRequestStatus[pr.status || 0],
    repository: pr.repository?.name,
    createdBy: pr.createdBy?.displayName,
    createdDate: pr.creationDate,
    sourceRefName: pr.sourceRefName,
    targetRefName: pr.targetRefName,
    isDraft: pr.isDraft,
    mergeStatus: pr.mergeStatus,
    reviewersCount: pr.reviewers?.length
  })), null, 2);
}

// Helper para formatear reviewer
function formatReviewer(reviewer: gitInterfaces.IdentityRefWithVote): string {
  return JSON.stringify({
    displayName: reviewer.displayName,
    vote: reviewer.vote,
    voteLabel: getVoteLabel(reviewer.vote),
    isRequired: reviewer.isRequired,
    hasDeclined: reviewer.hasDeclined
  }, null, 2);
}

// Helper para formatear lista de reviewers
function formatReviewerList(reviewers: gitInterfaces.IdentityRefWithVote[]): string {
  return JSON.stringify(reviewers.map(r => ({
    id: r.id,
    displayName: r.displayName,
    uniqueName: r.uniqueName,
    imageUrl: r.imageUrl,
    vote: r.vote,
    voteLabel: getVoteLabel(r.vote),
    isRequired: r.isRequired,
    hasDeclined: r.hasDeclined,
    isFlagged: r.isFlagged
  })), null, 2);
}

// Helper para formatear lista de hilos
function formatThreadList(threads: gitInterfaces.GitPullRequestCommentThread[]): string {
  return JSON.stringify(threads.map(t => ({
    id: t.id,
    status: gitInterfaces.CommentThreadStatus[t.status || 0],
    filePath: (t.pullRequestThreadContext as any)?.filePath,
    position: t.pullRequestThreadContext
      ? {
          startLine: (t.pullRequestThreadContext as any).rightFileStart?.line,
          endLine: (t.pullRequestThreadContext as any).rightFileEnd?.line
        }
      : undefined,
    comments: t.comments?.map(c => ({
      id: c.id,
      author: c.author?.displayName,
      content: c.content,
      publishedDate: c.publishedDate,
      likesCount: c.usersLiked?.length
    })),
    lastUpdatedDate: t.lastUpdatedDate
  })), null, 2);
}

// Helper para formatear lista de commits
function formatCommitList(commits: gitInterfaces.GitCommitRef[]): string {
  return JSON.stringify(commits.map(c => ({
    commitId: c.commitId,
    author: c.author?.name,
    authorEmail: c.author?.email,
    authorDate: c.author?.date,
    comment: c.comment,
    changeCount: c.changeCounts,
    commitUrl: c.remoteUrl
  })), null, 2);
}

// ============================================
// HERRAMIENTAS DE AZURE DEVOPS - AUTENTICACIÓN
// ============================================

// Configurar Azure DevOps con PAT
server.tool(
  "ado_configure",
  "Configura la conexión a Azure DevOps con token de acceso personal (PAT).",
  {
    organization: z
      .string()
      .describe("URL de la organización (ej: https://dev.azure.com/mi-org)"),
    project: z.string().describe("Nombre del proyecto"),
    pat: z
      .string()
      .describe("Token de acceso personal (PAT) de Azure DevOps"),
  },
  async ({ organization, project, pat }) => {
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    connection = new azdev.WebApi(organization, authHandler);
    workItemTrackingApi = null;
    coreApiClient = null;
    gitApiClient = null;
    currentProject = project;
    currentPat = pat;
    currentOrg = organization;

    // Verificar conexión
    try {
      const connData = await connection.connect();
      return {
        content: [
          {
            type: "text",
            text: `Conexión establecida exitosamente.\n- Organización: ${organization}\n- Proyecto: ${project}\n- Usuario autenticado: ${connData.authenticatedUser?.providerDisplayName || "N/A"}`,
          },
        ],
      };
    } catch (error: any) {
      connection = null;
      throw new Error(`Error al conectar: ${error.message}`);
    }
  }
);

// ============================================
// HERRAMIENTAS DE AZURE DEVOPS WORK ITEMS
// ============================================

// Obtener un Work Item por ID
server.tool(
  "ado_get_work_item",
  "Obtiene un Work Item de Azure DevOps por su ID",
  {
    id: z.number().describe("El ID del Work Item"),
    full: z
      .boolean()
      .optional()
      .describe("Si es true, devuelve todos los campos"),
  },
  async ({ id, full }) => {
    const api = await getWitApi();
    const expand = full
      ? witInterfaces.WorkItemExpand.All
      : witInterfaces.WorkItemExpand.Fields;
    const workItem = await api.getWorkItem(id, undefined, undefined, expand);

    if (!workItem) {
      throw new Error(`Work Item con ID ${id} no encontrado`);
    }

    const result = full
      ? JSON.stringify(workItem, null, 2)
      : formatWorkItem(workItem);

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Consultar Work Items por Sprint
server.tool(
  "ado_query_sprint",
  "Consulta User Stories de un sprint específico en Azure DevOps",
  {
    iterationPath: z
      .string()
      .describe("Ruta del sprint (ej: 'Proyecto\\Sprint1')"),
    state: z
      .string()
      .optional()
      .describe("Filtrar por estado (Active, New, Closed, etc.)"),
  },
  async ({ iterationPath, state }) => {
    const api = await getWitApi();
    const stateFilter = state ? ` AND [System.State] = '${state}'` : "";
    const wiql: witInterfaces.Wiql = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems WHERE [System.WorkItemType] = 'User Story'${stateFilter} AND [System.IterationPath] UNDER '${iterationPath}' ORDER BY [System.Id]`,
    };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiql, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [
          { type: "text", text: "No se encontraron Work Items en este sprint" },
        ],
      };
    }

    // Obtener detalles de los Work Items
    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(
      ids,
      ["System.Id", "System.Title", "System.State", "System.Tags"]
    );

    const result = workItems
      .map((wi) => {
        const fields = wi.fields || {};
        return `ID: ${wi.id} | ${fields["System.Title"]} | Estado: ${fields["System.State"]} | Tags: ${fields["System.Tags"] || "N/A"}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: result || "Sin resultados" }],
    };
  }
);

// Consultar Work Items por Área
server.tool(
  "ado_query_area",
  "Consulta User Stories de un área específica en Azure DevOps",
  {
    areaPath: z.string().describe("Ruta del área (ej: 'Proyecto\\Equipo')"),
    workItemType: z
      .string()
      .optional()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
  },
  async ({ areaPath, workItemType }) => {
    const api = await getWitApi();
    const type = workItemType || "User Story";
    const wiql: witInterfaces.Wiql = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems WHERE [System.WorkItemType] = '${type}' AND [System.AreaPath] UNDER '${areaPath}' ORDER BY [System.Id] DESC`,
    };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiql, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [
          { type: "text", text: "No se encontraron Work Items en esta área" },
        ],
      };
    }

    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(
      ids,
      ["System.Id", "System.Title", "System.State", "System.Tags"]
    );

    const result = workItems
      .map((wi) => {
        const fields = wi.fields || {};
        return `ID: ${wi.id} | ${fields["System.Title"]} | Estado: ${fields["System.State"]} | Tags: ${fields["System.Tags"] || "N/A"}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: result || "Sin resultados" }],
    };
  }
);

// Ejecutar query WIQL personalizado
server.tool(
  "ado_query_wiql",
  "Ejecuta una consulta WIQL personalizada en Azure DevOps",
  {
    wiql: z.string().describe("Query WIQL completa"),
    getDetails: z
      .boolean()
      .optional()
      .describe("Si es true, obtiene los detalles completos de cada Work Item"),
  },
  async ({ wiql, getDetails }) => {
    const api = await getWitApi();
    const wiqlQuery: witInterfaces.Wiql = { query: wiql };

    const teamContext = { project: currentProject };
    const queryResult = await api.queryByWiql(wiqlQuery, teamContext);
    const workItemRefs = queryResult.workItems || [];

    if (workItemRefs.length === 0) {
      return {
        content: [{ type: "text", text: "No se encontraron resultados" }],
      };
    }

    if (!getDetails) {
      return {
        content: [{ type: "text", text: formatWorkItemList(workItemRefs) }],
      };
    }

    const ids = workItemRefs.map((wi) => wi.id!).filter((id): id is number => id !== undefined);
    const workItems = await api.getWorkItems(ids);

    const result = workItems.map((wi) => formatWorkItem(wi)).join("\n---\n");

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Obtener campos de un tipo de Work Item
server.tool(
  "ado_get_work_item_type_fields",
  "Obtiene los campos disponibles y requeridos para un tipo de Work Item",
  {
    workItemType: z
      .string()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
  },
  async ({ workItemType }) => {
    const api = await getWitApi();

    const fields = await api.getWorkItemTypeFieldsWithReferences(
      currentProject,
      workItemType
    );

    const result = fields.map((field) => {
      const required = field.alwaysRequired ? "REQUERIDO" : "opcional";
      const allowedValues = field.allowedValues?.length
        ? `\n     Valores permitidos: ${field.allowedValues.join(", ")}`
        : "";
      const defaultValue = field.defaultValue
        ? `\n     Valor por defecto: ${field.defaultValue}`
        : "";
      return `- ${field.referenceName} (${required})${allowedValues}${defaultValue}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Campos para "${workItemType}":\n\n${result.join("\n")}`,
        },
      ],
    };
  }
);

// Crear un Work Item
server.tool(
  "ado_create_work_item",
  "Crea un nuevo Work Item en Azure DevOps. Usa ado_get_work_item_type_fields para ver campos requeridos.",
  {
    title: z.string().describe("Título del Work Item"),
    type: z
      .string()
      .describe("Tipo de Work Item (User Story, Bug, Task, etc.)"),
    description: z.string().optional().describe("Descripción del Work Item"),
    areaPath: z.string().optional().describe("Ruta del área"),
    iterationPath: z.string().optional().describe("Ruta del sprint/iteración"),
    assignedTo: z.string().optional().describe("Usuario asignado"),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe("Campos adicionales como objeto {nombreCampo: valor}. Ej: {'Custom.OKR': 'valor'}"),
  },
  async ({ title, type, description, areaPath, iterationPath, assignedTo, fields }) => {
    const api = await getWitApi();

    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Title",
        value: title,
      },
    ];

    if (description) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Description",
        value: description,
      });
    }

    if (areaPath) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AreaPath",
        value: areaPath,
      });
    }

    if (iterationPath) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.IterationPath",
        value: iterationPath,
      });
    }

    if (assignedTo) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AssignedTo",
        value: assignedTo,
      });
    }

    // Agregar campos personalizados
    if (fields) {
      for (const [fieldName, value] of Object.entries(fields)) {
        patchDocument.push({
          op: VSSInterfaces.Operation.Add,
          path: `/fields/${fieldName}`,
          value: value,
        });
      }
    }

    const workItem = await api.createWorkItem(
      null,
      patchDocument,
      currentProject,
      type
    );

    return {
      content: [
        {
          type: "text",
          text: `Work Item creado exitosamente:\n${formatWorkItem(workItem)}`,
        },
      ],
    };
  }
);

// Actualizar un Work Item
server.tool(
  "ado_update_work_item",
  "Actualiza un Work Item existente en Azure DevOps",
  {
    id: z.number().describe("ID del Work Item a actualizar"),
    title: z.string().optional().describe("Nuevo título"),
    state: z
      .string()
      .optional()
      .describe("Nuevo estado (New, Active, Closed, etc.)"),
    assignedTo: z.string().optional().describe("Usuario asignado"),
    description: z.string().optional().describe("Nueva descripción"),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe("Campos adicionales como objeto {campo: valor}"),
  },
  async ({ id, title, state, assignedTo, description, fields }) => {
    const api = await getWitApi();

    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [];

    if (title) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Title",
        value: title,
      });
    }

    if (state) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.State",
        value: state,
      });
    }

    if (assignedTo) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.AssignedTo",
        value: assignedTo,
      });
    }

    if (description) {
      patchDocument.push({
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.Description",
        value: description,
      });
    }

    if (fields) {
      for (const [field, value] of Object.entries(fields)) {
        patchDocument.push({
          op: VSSInterfaces.Operation.Add,
          path: `/fields/${field}`,
          value: value,
        });
      }
    }

    if (patchDocument.length === 0) {
      throw new Error("Debe proporcionar al menos un campo para actualizar");
    }

    const workItem = await api.updateWorkItem(
      null,
      patchDocument,
      id
    );

    return {
      content: [
        {
          type: "text",
          text: `Work Item actualizado exitosamente:\n${formatWorkItem(workItem)}`,
        },
      ],
    };
  }
);

// Listar iteraciones/sprints
server.tool(
  "ado_list_iterations",
  "Lista las iteraciones/sprints disponibles en el proyecto",
  {},
  async () => {
    try {
      const api = await getWitApi();
      const iterations = await api.getClassificationNode(
        currentProject,
        witInterfaces.TreeStructureGroup.Iterations,
        undefined,
        10
      );

      function formatIterations(
        node: witInterfaces.WorkItemClassificationNode,
        indent: string = ""
      ): string {
        let result = `${indent}${node.name}`;
        if (node.attributes) {
          const startDate = node.attributes["startDate"];
          const finishDate = node.attributes["finishDate"];
          if (startDate || finishDate) {
            result += ` (${startDate ? new Date(startDate).toLocaleDateString() : "?"} - ${finishDate ? new Date(finishDate).toLocaleDateString() : "?"})`;
          }
        }
        result += "\n";

        if (node.children) {
          for (const child of node.children) {
            result += formatIterations(child, indent + "  ");
          }
        }
        return result;
      }

      const result = formatIterations(iterations);

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Listar áreas del proyecto
server.tool(
  "ado_list_areas",
  "Lista las áreas disponibles en el proyecto",
  {},
  async () => {
    try {
      const api = await getWitApi();
      const areas = await api.getClassificationNode(
        currentProject,
        witInterfaces.TreeStructureGroup.Areas,
        undefined,
        10
      );

      function formatAreas(
        node: witInterfaces.WorkItemClassificationNode,
        indent: string = ""
      ): string {
        let result = `${indent}${node.name}\n`;
        if (node.children) {
          for (const child of node.children) {
            result += formatAreas(child, indent + "  ");
          }
        }
        return result;
      }

      const result = formatAreas(areas);

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// ============================================
// HERRAMIENTAS DE DISCUSIONES / COMENTARIOS
// ============================================

// Agregar comentario a un Work Item
server.tool(
  "ado_add_comment",
  "Agrega un comentario/entrada de discusión a un Work Item. Soporta formato Markdown.",
  {
    id: z.number().describe("ID del Work Item"),
    comment: z.string().describe("Texto del comentario (soporta Markdown)"),
  },
  async ({ id, comment }) => {
    const api = await getWitApi();

    // Usar System.History para agregar comentario
    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/fields/System.History",
        value: comment,
      },
    ];

    await api.updateWorkItem(null, patchDocument, id);

    return {
      content: [
        {
          type: "text",
          text: `Comentario agregado exitosamente al Work Item #${id}`,
        },
      ],
    };
  }
);

// Obtener comentarios de un Work Item
server.tool(
  "ado_get_comments",
  "Obtiene los comentarios/historial de discusión de un Work Item",
  {
    id: z.number().describe("ID del Work Item"),
    top: z.number().optional().describe("Número máximo de comentarios a obtener (por defecto 10)"),
  },
  async ({ id, top = 10 }) => {
    const api = await getWitApi();

    const comments = await api.getComments(currentProject, id, top);

    if (!comments.comments || comments.comments.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay comentarios en el Work Item #${id}`,
          },
        ],
      };
    }

    const result = comments.comments
      .map((comment) => {
        const author = comment.createdBy?.displayName || "Desconocido";
        const date = comment.createdDate
          ? new Date(comment.createdDate).toLocaleString()
          : "Fecha desconocida";
        const text = comment.text || "(sin contenido)";
        return `**${author}** - ${date}\n${text}\n`;
      })
      .join("\n---\n");

    return {
      content: [
        {
          type: "text",
          text: `Comentarios del Work Item #${id}:\n\n${result}`,
        },
      ],
    };
  }
);

// ============================================
// HERRAMIENTAS DE ADJUNTOS / ATTACHMENTS
// ============================================

// Subir un archivo como adjunto
server.tool(
  "ado_upload_attachment",
  "Sube un archivo como adjunto a Azure DevOps y devuelve la URL del adjunto",
  {
    filePath: z.string().describe("Ruta completa del archivo a subir"),
    fileName: z.string().optional().describe("Nombre del archivo (opcional, se usa el nombre del archivo si no se especifica)"),
  },
  async ({ filePath, fileName }) => {
    if (!currentPat || !currentOrg) {
      throw new Error("No hay conexión configurada. Usa ado_configure primero.");
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`El archivo no existe: ${filePath}`);
    }

    const name = fileName || path.basename(filePath);
    const attachment = await uploadAttachmentRest(filePath, name);

    return {
      content: [
        {
          type: "text",
          text: `Archivo subido exitosamente:\n- Nombre: ${name}\n- URL: ${attachment.url}\n- ID: ${attachment.id}\n\nUsa esta URL con ado_add_attachment para vincular el adjunto a un Work Item.`,
        },
      ],
    };
  }
);

// Agregar adjunto a un Work Item existente
server.tool(
  "ado_add_attachment",
  "Agrega un adjunto a un Work Item existente. Puede subir un archivo nuevo o vincular uno ya subido.",
  {
    workItemId: z.number().describe("ID del Work Item"),
    filePath: z.string().optional().describe("Ruta del archivo a subir (opcional si se usa attachmentUrl)"),
    attachmentUrl: z.string().optional().describe("URL de un adjunto ya subido (opcional si se usa filePath)"),
    comment: z.string().optional().describe("Comentario para el adjunto"),
    name: z.string().optional().describe("Nombre del archivo (si no se especifica, usa el nombre del archivo original)"),
  },
  async ({ workItemId, filePath, attachmentUrl, comment, name }) => {
    const api = await getWitApi();

    let attachmentId: string | undefined;
    let fileName: string | undefined;

    // Si se proporciona un archivo, subirlo primero usando REST API
    if (filePath) {
      if (!currentPat || !currentOrg) {
        throw new Error("No hay conexión configurada. Usa ado_configure primero.");
      }

      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }

      fileName = name || path.basename(filePath);
      const attachment = await uploadAttachmentRest(filePath, fileName);
      // Usar directamente la URL devuelta por Azure DevOps (ya tiene el formato correcto)
      attachmentId = attachment.id;
    } else if (attachmentUrl) {
      // Extraer el ID del adjunto de la URL
      // La URL del attachment tiene formato: https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{id}
      const urlParts = attachmentUrl.split('/attachments/');
      if (urlParts.length === 2) {
        attachmentId = urlParts[1].split('?')[0];
      } else {
        throw new Error("Formato de URL de adjunto inválido. La URL debe ser la devuelta por ado_upload_attachment");
      }
      fileName = name || "Archivo adjunto";
    }

    if (!attachmentId) {
      throw new Error("Debe proporcionar filePath o attachmentUrl");
    }

    // Construir la URL correcta para vincular el adjunto al Work Item
    // Debe incluir el proyecto en la URL
    const baseUrl = currentOrg.endsWith("/") ? currentOrg.slice(0, -1) : currentOrg;
    const encodedProject = encodeURIComponent(currentProject);
    const attachmentLinkUrl = `${baseUrl}/${encodedProject}/_apis/wit/attachments/${attachmentId}`;

    // Vincular el adjunto al Work Item
    const patchDocument: VSSInterfaces.JsonPatchOperation[] = [
      {
        op: VSSInterfaces.Operation.Add,
        path: "/relations/-",
        value: {
          rel: "AttachedFile",
          url: attachmentLinkUrl,
          attributes: {
            name: fileName,
            comment: comment || "",
          },
        },
      },
    ];

    await api.updateWorkItem(null, patchDocument, workItemId);

    return {
      content: [
        {
          type: "text",
          text: `Adjunto agregado exitosamente al Work Item #${workItemId}\n- Nombre: ${fileName}\n- URL: ${attachmentLinkUrl}`,
        },
      ],
    };
  }
);

// Obtener adjuntos de un Work Item
server.tool(
  "ado_get_attachments",
  "Obtiene la lista de adjuntos de un Work Item",
  {
    id: z.number().describe("ID del Work Item"),
  },
  async ({ id }) => {
    const api = await getWitApi();

    const workItem = await api.getWorkItem(
      id,
      undefined,
      undefined,
      witInterfaces.WorkItemExpand.Relations
    );

    if (!workItem.relations || workItem.relations.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay adjuntos en el Work Item #${id}`,
          },
        ],
      };
    }

    const attachments = workItem.relations
      .filter((rel) => rel.rel === "AttachedFile")
      .map((rel) => {
        const comment = rel.attributes?.comment || "";
        const name = rel.attributes?.name || "Sin nombre";
        return `- ${name}\n  URL: ${rel.url}\n  Comentario: ${comment || "(sin comentario)"}`;
      });

    if (attachments.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No hay adjuntos en el Work Item #${id}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Adjuntos del Work Item #${id}:\n\n${attachments.join("\n\n")}`,
        },
      ],
    };
  }
);

// ============================================
// HERRAMIENTAS DE AZURE REPOS (GIT)
// ============================================

// Repositorios
server.tool(
  "ado_list_repositories",
  "Lista todos los repositorios Git del proyecto.",
  {
    includeHidden: z.boolean().optional().describe("Incluir repositorios ocultos"),
    top: z.number().optional().describe("Número máximo a devolver (default: 100)")
  },
  async ({ includeHidden, top }) => {
    try {
      const api = await getGitApi();
      const repos = await api.getRepositories(
        currentProject,
        undefined,
        undefined,
        includeHidden
      );
      const limited = top ? repos.slice(0, top) : repos;
      return {
        content: [{
          type: "text",
          text: formatRepositoryList(limited)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_get_repository",
  "Obtiene detalles de un repositorio específico por nombre o ID.",
  {
    repositoryId: z.string().describe("Nombre o ID del repositorio")
  },
  async ({ repositoryId }) => {
    try {
      const api = await getGitApi();
      const repo = await api.getRepository(repositoryId, currentProject);
      return {
        content: [{
          type: "text",
          text: formatRepository(repo)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_list_branches",
  "Lista las ramas (branches) de un repositorio.",
  {
    repositoryId: z.string().describe("Nombre o ID del repositorio"),
    filter: z.string().optional().describe("Filtrar por substring del nombre"),
    includeStatuses: z.boolean().optional().describe("Incluir estados de las ramas")
  },
  async ({ repositoryId, filter, includeStatuses }) => {
    try {
      const api = await getGitApi();
      const refs = await api.getRefs(
        repositoryId,
        currentProject,
        "heads/",
        undefined,
        includeStatuses
      );
      const filtered = filter
        ? refs.filter(r => r.name?.toLowerCase().includes(filter.toLowerCase()))
        : refs;
      return {
        content: [{
          type: "text",
          text: formatBranchList(filtered)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Pull Requests
server.tool(
  "ado_list_pull_requests",
  "Lista Pull Requests con filtros opcionales. Busca por repositorio o en todo el proyecto.",
  {
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio (omitir para búsqueda en todo el proyecto)"),
    status: z.enum(["Active", "Completed", "Abandoned", "All"]).optional().describe("Filtrar por estado"),
    sourceRefName: z.string().optional().describe("Filtrar por rama de origen (ej: 'refs/heads/feature-1')"),
    targetRefName: z.string().optional().describe("Filtrar por rama de destino"),
    creatorId: z.string().optional().describe("Filtrar por ID del creador"),
    reviewerId: z.string().optional().describe("Filtrar por ID del revisor"),
    top: z.number().optional().describe("Número máximo a devolver (default: 100)")
  },
  async ({ repositoryId, status, sourceRefName, targetRefName, creatorId, reviewerId, top }) => {
    try {
      const api = await getGitApi();

      const searchCriteria: gitInterfaces.GitPullRequestSearchCriteria = {
        status: status ? gitInterfaces.PullRequestStatus[status as keyof typeof gitInterfaces.PullRequestStatus] : undefined,
        sourceRefName,
        targetRefName,
        creatorId,
        reviewerId
      };

      let prs: gitInterfaces.GitPullRequest[];

      if (repositoryId) {
        prs = await api.getPullRequests(
          repositoryId,
          searchCriteria,
          currentProject,
          undefined,
          undefined,
          top
        );
      } else {
        prs = await api.getPullRequestsByProject(
          currentProject,
          searchCriteria,
          undefined,
          undefined,
          top
        );
      }

      return {
        content: [{
          type: "text",
          text: formatPullRequestList(prs)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_get_pull_request",
  "Obtiene detalles completos de un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio (opcional si se usa acceso a todo el proyecto)"),
    includeCommits: z.boolean().optional().describe("Incluir commits del PR"),
    includeWorkItems: z.boolean().optional().describe("Incluir work items vinculados")
  },
  async ({ pullRequestId, repositoryId, includeCommits, includeWorkItems }) => {
    try {
      const api = await getGitApi();

      let pr: gitInterfaces.GitPullRequest;

      if (repositoryId) {
        pr = await api.getPullRequest(
          repositoryId,
          pullRequestId,
          currentProject,
          undefined,
          undefined,
          undefined,
          includeCommits,
          includeWorkItems
        );
      } else {
        pr = await api.getPullRequestById(pullRequestId, currentProject);
      }

      return {
        content: [{
          type: "text",
          text: formatPullRequest(pr)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_create_pull_request",
  "Crea un nuevo Pull Request.",
  {
    repositoryId: z.string().describe("Nombre o ID del repositorio"),
    sourceRefName: z.string().describe("Rama de origen (ej: 'refs/heads/feature-1')"),
    targetRefName: z.string().describe("Rama de destino (ej: 'refs/heads/main')"),
    title: z.string().describe("Título del Pull Request"),
    description: z.string().optional().describe("Descripción del Pull Request"),
    reviewerIds: z.array(z.string()).optional().describe("Lista de IDs de identidad de los revisores"),
    isDraft: z.boolean().optional().describe("Crear como borrador")
  },
  async ({ repositoryId, sourceRefName, targetRefName, title, description, reviewerIds, isDraft }) => {
    try {
      const api = await getGitApi();

      const prToCreate: gitInterfaces.GitPullRequest = {
        sourceRefName,
        targetRefName,
        title,
        description,
        isDraft
      };

      if (reviewerIds && reviewerIds.length > 0) {
        prToCreate.reviewers = reviewerIds.map(id => ({
          id: id
        } as gitInterfaces.IdentityRefWithVote));
      }

      const pr = await api.createPullRequest(prToCreate, repositoryId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Pull Request creado exitosamente.\n\n${formatPullRequest(pr)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_update_pull_request",
  "Actualiza propiedades de un Pull Request (título, descripción, estado de borrador).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    title: z.string().optional().describe("Nuevo título"),
    description: z.string().optional().describe("Nueva descripción"),
    isDraft: z.boolean().optional().describe("Establecer estado de borrador")
  },
  async ({ pullRequestId, repositoryId, title, description, isDraft }) => {
    try {
      const api = await getGitApi();

      const update: gitInterfaces.GitPullRequest = {};

      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (isDraft !== undefined) update.isDraft = isDraft;

      const pr = repositoryId
        ? await api.updatePullRequest(update, repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Pull Request actualizado exitosamente.\n\n${formatPullRequest(pr)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_complete_pull_request",
  "Completa (merge) un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    mergeStrategy: z.enum(["NoFastForward", "Squash", "Rebase", "RebaseMerge"]).optional().describe("Estrategia de merge (default: NoFastForward)"),
    deleteSourceBranch: z.boolean().optional().describe("Eliminar rama de origen después del merge"),
    transitionWorkItems: z.boolean().optional().describe("Transicionar work items vinculados"),
    mergeCommitMessage: z.string().optional().describe("Mensaje personalizado del commit de merge")
  },
  async ({ pullRequestId, repositoryId, mergeStrategy, deleteSourceBranch, transitionWorkItems, mergeCommitMessage }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const update: gitInterfaces.GitPullRequest = {
        status: gitInterfaces.PullRequestStatus.Completed,
        lastMergeSourceCommit: currentPr.lastMergeSourceCommit,
        completionOptions: {
          mergeStrategy: mergeStrategy
            ? gitInterfaces.GitPullRequestMergeStrategy[mergeStrategy as keyof typeof gitInterfaces.GitPullRequestMergeStrategy]
            : gitInterfaces.GitPullRequestMergeStrategy.NoFastForward
        }
      };

      if (deleteSourceBranch !== undefined) update.completionOptions!.deleteSourceBranch = deleteSourceBranch;
      if (transitionWorkItems !== undefined) update.completionOptions!.transitionWorkItems = transitionWorkItems;
      if (mergeCommitMessage !== undefined) update.completionOptions!.mergeCommitMessage = mergeCommitMessage;

      const pr = await api.updatePullRequest(update, repositoryIdActual, pullRequestId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Pull Request completado exitosamente.\n\n${formatPullRequest(pr)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_abandon_pull_request",
  "Abandona un Pull Request (cambia estado a Abandoned).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio")
  },
  async ({ pullRequestId, repositoryId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const pr = await api.updatePullRequest(
        { status: gitInterfaces.PullRequestStatus.Abandoned },
        repositoryIdActual,
        pullRequestId,
        currentProject
      );

      return {
        content: [{
          type: "text",
          text: `Pull Request abandonado exitosamente.\n\n${formatPullRequest(pr)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Pull Request Reviews
server.tool(
  "ado_approve_pull_request",
  "Aprueba un Pull Request (voto: 10).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    reviewerId: z.string().optional().describe("ID de identidad del aprobador (default: usuario autenticado si está disponible)")
  },
  async ({ pullRequestId, repositoryId, reviewerId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      let actualReviewerId = reviewerId;
      if (!actualReviewerId) {
        const conn = await getConnection();
        const connData = await conn.connect();
        actualReviewerId = connData.authenticatedUser?.id;
        if (!actualReviewerId) {
          throw new Error("Cannot determine authenticated user ID. Please provide reviewerId explicitly.");
        }
      }

      const reviewer: gitInterfaces.IdentityRefWithVote = {
        id: actualReviewerId,
        vote: 10
      };

      const result = await api.createPullRequestReviewer(
        reviewer,
        repositoryIdActual,
        pullRequestId,
        actualReviewerId,
        currentProject
      );

      return {
        content: [{
          type: "text",
          text: `Pull Request aprobado exitosamente.\n\n${formatReviewer(result)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_reject_pull_request",
  "Rechaza un Pull Request (voto: -10).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    reviewerId: z.string().optional().describe("ID de identidad del revisor (default: usuario autenticado si está disponible)")
  },
  async ({ pullRequestId, repositoryId, reviewerId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      let actualReviewerId = reviewerId;
      if (!actualReviewerId) {
        const conn = await getConnection();
        const connData = await conn.connect();
        actualReviewerId = connData.authenticatedUser?.id;
        if (!actualReviewerId) {
          throw new Error("Cannot determine authenticated user ID. Please provide reviewerId explicitly.");
        }
      }

      const reviewer: gitInterfaces.IdentityRefWithVote = {
        id: actualReviewerId,
        vote: -10
      };

      const result = await api.createPullRequestReviewer(
        reviewer,
        repositoryIdActual,
        pullRequestId,
        actualReviewerId,
        currentProject
      );

      return {
        content: [{
          type: "text",
          text: `Pull Request rechazado exitosamente.\n\n${formatReviewer(result)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_get_pull_request_reviewers",
  "Obtiene todos los revisores y sus votos de un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio")
  },
  async ({ pullRequestId, repositoryId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const reviewers = await api.getPullRequestReviewers(
        repositoryIdActual,
        pullRequestId,
        currentProject
      );

      return {
        content: [{
          type: "text",
          text: formatReviewerList(reviewers)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_add_pull_request_reviewer",
  "Agrega un revisor a un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    reviewerId: z.string().describe("ID de identidad del revisor a agregar"),
    vote: z.number().optional().describe("Valor inicial del voto (default: 0 = sin voto)")
  },
  async ({ pullRequestId, repositoryId, reviewerId, vote }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const reviewer: gitInterfaces.IdentityRefWithVote = {
        id: reviewerId,
        vote: vote ?? 0
      };

      const result = await api.createPullRequestReviewer(
        reviewer,
        repositoryIdActual,
        pullRequestId,
        reviewerId,
        currentProject
      );

      return {
        content: [{
          type: "text",
          text: `Reviewer agregado exitosamente.\n\n${formatReviewer(result)}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Pull Request Comments
server.tool(
  "ado_get_pull_request_threads",
  "Obtiene todos los hilos de comentarios de un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio")
  },
  async ({ pullRequestId, repositoryId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const threads = await api.getThreads(repositoryIdActual, pullRequestId, currentProject);

      return {
        content: [{
          type: "text",
          text: formatThreadList(threads)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_create_pull_request_thread",
  "Crea un nuevo hilo de comentarios (comentario general o comentario de código).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    content: z.string().describe("Contenido del comentario"),
    filePath: z.string().optional().describe("Ruta del archivo para comentario de código (opcional para comentario general)"),
    startLine: z.number().optional().describe("Línea de inicio para comentario de código (1-indexed)"),
    endLine: z.number().optional().describe("Línea de fin para comentario de código (1-indexed)")
  },
  async ({ pullRequestId, repositoryId, content, filePath, startLine, endLine }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const thread: gitInterfaces.GitPullRequestCommentThread = {
        comments: [{
          content,
          commentType: gitInterfaces.CommentType.Text,
          parentCommentId: 0
        }],
        status: gitInterfaces.CommentThreadStatus.Active
      };

      if (filePath && startLine !== undefined) {
        (thread as any).pullRequestThreadContext = {
          filePath,
          rightFileStart: { line: startLine, offset: 1 },
          rightFileEnd: { line: endLine ?? startLine, offset: 50 }
        };
      }

      const result = await api.createThread(thread, repositoryIdActual, pullRequestId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Hilo de comentarios creado exitosamente.\n\n${formatThreadList([result])}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_reply_to_pull_request_thread",
  "Responde a un hilo de comentarios existente.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    threadId: z.number().describe("ID del hilo a responder"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    content: z.string().describe("Contenido de la respuesta")
  },
  async ({ pullRequestId, threadId, repositoryId, content }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const comment: gitInterfaces.Comment = {
        content,
        commentType: gitInterfaces.CommentType.Text
      };

      const result = await api.createComment(comment, repositoryIdActual, pullRequestId, threadId, currentProject);

      const updatedThread = await api.getPullRequestThread(repositoryIdActual, pullRequestId, threadId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Respuesta agregada exitosamente.\n\n${formatThreadList([updatedThread])}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Pull Request Info
server.tool(
  "ado_get_pull_request_commits",
  "Obtiene todos los commits de un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    top: z.number().optional().describe("Número máximo a devolver (default: 100)")
  },
  async ({ pullRequestId, repositoryId, top }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      let commits = await api.getPullRequestCommits(repositoryIdActual, pullRequestId, currentProject);

      const commitArray: gitInterfaces.GitCommitRef[] = [];
      for await (const commit of commits) {
        commitArray.push(commit);
        if (top && commitArray.length >= top) break;
      }

      return {
        content: [{
          type: "text",
          text: formatCommitList(commitArray)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_get_pull_request_work_items",
  "Obtiene los work items vinculados a un Pull Request.",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio")
  },
  async ({ pullRequestId, repositoryId }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const workItems = await api.getPullRequestWorkItemRefs(repositoryIdActual, pullRequestId, currentProject);

      const witApiInstance = await getWitApi();
      const ids = workItems.map(wi => parseInt(wi.id!)).filter(id => !isNaN(id));
      const fullItems = ids.length > 0 ? await witApiInstance.getWorkItems(ids, ["System.Id", "System.Title", "System.WorkItemType", "System.State"]) : [];

      return {
        content: [{
          type: "text",
          text: JSON.stringify(fullItems.map(wi => ({
            id: wi.id,
            title: wi.fields?.["System.Title"],
            type: wi.fields?.["System.WorkItemType"],
            state: wi.fields?.["System.State"],
            url: wi.url
          })), null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "ado_update_pull_request_thread_status",
  "Actualiza el estado de un hilo de comentarios (ej: marcar como Fixed, WontFix, etc.).",
  {
    pullRequestId: z.number().describe("ID del Pull Request"),
    threadId: z.number().describe("ID del hilo"),
    repositoryId: z.string().optional().describe("Nombre o ID del repositorio"),
    status: z.enum(["Active", "Fixed", "WontFix", "Closed", "ByDesign", "Pending"]).describe("Nuevo estado del hilo")
  },
  async ({ pullRequestId, threadId, repositoryId, status }) => {
    try {
      const api = await getGitApi();

      const currentPr = repositoryId
        ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
        : await api.getPullRequestById(pullRequestId, currentProject);

      const repositoryIdActual = repositoryId || currentPr.repository?.id!;

      const update: gitInterfaces.GitPullRequestCommentThread = {
        status: gitInterfaces.CommentThreadStatus[status as keyof typeof gitInterfaces.CommentThreadStatus]
      };

      const result = await api.updateThread(update, repositoryIdActual, pullRequestId, threadId, currentProject);

      return {
        content: [{
          type: "text",
          text: `Estado del hilo actualizado exitosamente.\n\n${formatThreadList([result])}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// ============================================
// PROMPTS DE MCP PARA IA
// ============================================

// Prompt para iniciar sesión en Azure DevOps
server.prompt(
  "connect",
  "Inicia sesión en Azure DevOps usando un Personal Access Token (PAT).",
  {
    organization: z
      .string()
      .describe("URL de la organización (ej: https://dev.azure.com/mi-org)"),
    project: z.string().optional().describe("Nombre del proyecto"),
    pat: z.string().describe("Personal Access Token (PAT)"),
  },
  async ({ organization, project, pat }) => {
    let instructions = `Conectando a Azure DevOps...

**Datos de conexión:**
- Organización: ${organization}
- Proyecto: ${project || "(no especificado)"}
- PAT: ****${pat.slice(-4)}

`;

    if (!project) {
      instructions += `Por favor proporciona el nombre del proyecto para continuar.

Una vez tengas el proyecto, ejecuta:
\`ado_configure(organization="${organization}", project="TU_PROYECTO", pat="${pat}")\``;
    } else {
      instructions += `Ejecuta la herramienta ado_configure para establecer la conexión:
\`ado_configure(organization="${organization}", project="${project}", pat="${pat}")\``;
    }

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: instructions,
          },
        },
      ],
    };
  }
);

// Prompt para analizar un sprint
server.prompt(
  "analyze_sprint",
  "Analiza el estado actual de un sprint y proporciona un resumen",
  {
    iterationPath: z.string().describe("Ruta del sprint a analizar"),
  },
  async ({ iterationPath }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Por favor analiza el sprint "${iterationPath}" en Azure DevOps:

1. Primero, usa la herramienta ado_query_sprint para obtener todas las User Stories del sprint
2. Cuenta cuántas están en cada estado (New, Active, Closed, etc.)
3. Identifica si hay User Stories bloqueadas o en riesgo
4. Proporciona un resumen ejecutivo del progreso del sprint
5. Sugiere acciones si hay problemas

Usa las herramientas de Azure DevOps disponibles para obtener la información necesaria.`,
          },
        },
      ],
    };
  }
);

// Prompt para crear User Story desde descripción
server.prompt(
  "create_user_story",
  "Crea una User Story bien estructurada a partir de una descripción",
  {
    description: z.string().describe("Descripción de la funcionalidad deseada"),
    areaPath: z.string().optional().describe("Área del proyecto"),
    iterationPath: z.string().optional().describe("Sprint destino"),
  },
  async ({ description, areaPath, iterationPath }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Crea una User Story en Azure DevOps basada en esta descripción:

"${description}"

Requisitos:
1. Genera un título conciso y descriptivo
2. Escribe la descripción en formato: "Como [rol], quiero [acción] para [beneficio]"
3. Incluye criterios de aceptación claros
${areaPath ? `4. Asigna al área: ${areaPath}` : ""}
${iterationPath ? `5. Asigna al sprint: ${iterationPath}` : ""}

Usa la herramienta ado_create_work_item para crear la User Story con el contenido generado.`,
          },
        },
      ],
    };
  }
);

// Prompt para reporte diario de trabajo
server.prompt(
  "daily_standup",
  "Genera un reporte de standup diario basado en los work items",
  {
    assignedTo: z.string().describe("Usuario para el reporte"),
  },
  async ({ assignedTo }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Genera un reporte de standup diario para ${assignedTo}:

1. Usa ado_query_wiql para buscar:
   - Work Items activos asignados a "${assignedTo}"
   - Work Items completados recientemente por "${assignedTo}"

2. Organiza el reporte en formato standup:
   - ¿Qué se completó ayer?
   - ¿En qué se está trabajando hoy?
   - ¿Hay algún impedimento?

Consulta WIQL sugerida:
SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate]
FROM WorkItems
WHERE [System.AssignedTo] = '${assignedTo}'
AND [System.State] IN ('Active', 'Closed', 'Resolved')
ORDER BY [System.ChangedDate] DESC`,
          },
        },
      ],
    };
  }
);

// Prompt para planificación de sprint
server.prompt(
  "plan_sprint",
  "Ayuda a planificar un nuevo sprint",
  {
    iterationPath: z.string().describe("Ruta del sprint a planificar"),
    backlogArea: z.string().describe("Área del backlog a revisar"),
  },
  async ({ iterationPath, backlogArea }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Ayúdame a planificar el sprint "${iterationPath}":

1. Primero, lista las iteraciones disponibles con ado_list_iterations
2. Busca User Stories en el backlog (estado New) del área "${backlogArea}" usando ado_query_area
3. Para cada User Story candidata, muestra:
   - ID y Título
   - Estado actual
   - Tags relevantes

4. Sugiere cuáles User Stories priorizar basándote en:
   - Dependencias
   - Complejidad aparente
   - Valor de negocio (si hay tags indicativos)

5. Para las User Stories seleccionadas, puedo moverlas al sprint usando ado_update_work_item`,
          },
        },
      ],
    };
  }
);

// Prompt para buscar y actualizar work items
server.prompt(
  "bulk_update",
  "Actualiza múltiples work items basado en criterios",
  {
    searchCriteria: z.string().describe("Criterios de búsqueda en lenguaje natural"),
    updateAction: z.string().describe("Acción a realizar (ej: cambiar estado, asignar, mover a sprint)"),
  },
  async ({ searchCriteria, updateAction }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Necesito actualizar work items en Azure DevOps:

**Criterios de búsqueda:** ${searchCriteria}
**Acción a realizar:** ${updateAction}

Por favor:
1. Genera una consulta WIQL apropiada para encontrar los work items
2. Ejecuta ado_query_wiql para obtener los IDs
3. Muéstrame la lista de work items que coinciden
4. Pide confirmación antes de actualizar
5. Si confirmo, usa ado_update_work_item para cada uno

IMPORTANTE: Siempre muestra lo que vas a cambiar ANTES de hacerlo y espera mi confirmación.`,
          },
        },
      ],
    };
  }
);

// Prompt para generar reporte de proyecto
server.prompt(
  "project_report",
  "Genera un reporte del estado del proyecto",
  {},
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Genera un reporte completo del estado del proyecto en Azure DevOps:

1. **Estructura del proyecto:**
   - Usa ado_list_areas para mostrar las áreas
   - Usa ado_list_iterations para mostrar los sprints

2. **Estado por Sprint:**
   - Para cada sprint activo, cuenta work items por estado

3. **Métricas generales:**
   - Total de work items abiertos vs cerrados
   - Work items sin asignar
   - Work items antiguos (más de 30 días sin cambios)

4. **Recomendaciones:**
   - Identifica cuellos de botella
   - Sugiere acciones de mejora

Usa las herramientas disponibles para recopilar esta información.`,
          },
        },
      ],
    };
  }
);

// Prompt para crear bug desde descripción
server.prompt(
  "report_bug",
  "Crea un bug report estructurado a partir de una descripción",
  {
    bugDescription: z.string().describe("Descripción del bug encontrado"),
    severity: z.enum(["1 - Critical", "2 - High", "3 - Medium", "4 - Low"]).optional().describe("Severidad del bug"),
  },
  async ({ bugDescription, severity }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Crea un Bug en Azure DevOps basado en esta descripción:

"${bugDescription}"

Por favor:
1. Genera un título claro y conciso
2. Estructura la descripción con:
   - **Pasos para reproducir**
   - **Comportamiento esperado**
   - **Comportamiento actual**
   - **Ambiente/Contexto**
${severity ? `3. Severidad: ${severity}` : ""}

Usa la herramienta ado_create_work_item con type="Bug" para crear el bug.`,
          },
        },
      ],
    };
  }
);

// ============================================
// RECURSOS DE MCP
// ============================================

// Recurso para información de conexión
server.resource(
  "connection-status",
  "ado://connection/status",
  async () => {
    if (!connection) {
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({ connected: false, message: "No conectado. Usa ado_login o ado_configure." }),
          },
        ],
      };
    }

    try {
      const connData = await connection.connect();
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({
              connected: true,
              project: currentProject,
              user: connData.authenticatedUser?.providerDisplayName || "N/A",
              userId: connData.authenticatedUser?.id,
            }),
          },
        ],
      };
    } catch {
      return {
        contents: [
          {
            uri: "ado://connection/status",
            mimeType: "application/json",
            text: JSON.stringify({ connected: false, message: "Error al verificar conexión" }),
          },
        ],
      };
    }
  }
);

// Función para auto-configurar desde variables de entorno
async function autoConfigureFromEnv(): Promise<void> {
  if (ENV_ADO_ORG && ENV_ADO_PAT) {
    try {
      const authHandler = azdev.getPersonalAccessTokenHandler(ENV_ADO_PAT);
      connection = new azdev.WebApi(ENV_ADO_ORG, authHandler);
      workItemTrackingApi = null;
      coreApiClient = null;
      gitApiClient = null;
      currentProject = ENV_ADO_PROJECT || "";
      currentPat = ENV_ADO_PAT;
      currentOrg = ENV_ADO_ORG;

      const connData = await connection.connect();
      console.error(`Auto-configurado desde variables de entorno:`);
      console.error(`  - Organización: ${ENV_ADO_ORG}`);
      console.error(`  - Proyecto: ${ENV_ADO_PROJECT || "(no especificado)"}`);
      console.error(`  - Usuario: ${connData.authenticatedUser?.providerDisplayName || "N/A"}`);
    } catch (error: any) {
      console.error(`Error al auto-configurar desde variables de entorno: ${error.message}`);
      connection = null;
    }
  }
}

// Función principal para iniciar el servidor
async function main() {
  // Auto-configurar si hay variables de entorno
  await autoConfigureFromEnv();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP Azure DevOps iniciado (usando SDK)");
}

main().catch((error) => {
  console.error("Error al iniciar el servidor:", error);
  process.exit(1);
});
