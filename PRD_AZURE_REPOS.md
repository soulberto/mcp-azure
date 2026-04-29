# Product Requirements Document (PRD)
# Azure Repos Support for MCP Azure

## Document Overview
- **Version**: 1.0
- **Date**: 2026-03-10
- **Author**: Soulberto Lorenzo
- **Status**: Ready for Implementation
- **Product**: @slorenzot/mcp-azure

---

## 1. Executive Summary

### 1.1 Project Description
This PRD defines the requirements for adding Azure Repos (Git) support to the existing MCP Azure DevOps server. Currently, the server only supports Work Item Tracking operations. This enhancement will enable comprehensive repository and Pull Request management through the MCP protocol.

### 1.2 Business Value
- **Centralized Management**: Users can manage both work items and Git operations from a single MCP server
- **Increased Productivity**: Streamlined workflow for developers interacting with Azure DevOps via Claude Desktop
- **Consistent Experience**: Uniform tool naming and interface across all Azure DevOps operations

### 1.3 Current State
- Server currently supports 14 tools for Work Item Tracking
- Single-file architecture: `src/index.ts` (1315 lines)
- Uses `azure-devops-node-api` v14.1.0
- Authentication via PAT (Personal Access Token)

### 1.4 Target State
- Add 19 new tools for Azure Repos operations
- No breaking changes to existing functionality
- Maintain current architecture and patterns

---

## 2. Scope

### 2.1 In-Scope

| Category | Tools | Description |
|----------|-------|-------------|
| **Repositories** | 3 | List repos, get repo details, list branches |
| **Pull Requests - CRUD** | 6 | List, get, create, update, complete, abandon PRs |
| **Pull Requests - Reviews** | 4 | Approve, reject, get reviewers, add reviewer |
| **Pull Requests - Comments** | 3 | Get threads, create thread, reply to thread |
| **Pull Requests - Info** | 3 | Get commits, get work items, update thread status |

### 2.2 Out-of-Scope
- Pipelines/Builds API
- Release Management API
- Test Plans API
- Repository creation/deletion (read-only repo management)
- Git operations beyond listing (clone, push, fetch)

### 2.3 Dependencies
- All operations rely on existing `azure-devops-node-api` package
- No new npm dependencies required
- Requires PAT with "Code" scope permissions

---

## 3. Technical Specifications

### 3.1 Architecture

#### File Structure
```
mcp-azure/
└── src/
    └── index.ts           # Single-file architecture maintained
```

#### Code Organization Pattern
The new tools will be added to `src/index.ts` following the existing pattern:

```
[Current sections]
- Lines 15-24:   Environment variables
- Lines 27-74:   REST API helpers
- Lines 77-86:   Server + connection state
- Lines 89-174:  Helper functions
- Lines 177-218: AUTHENTICATION tools
- Lines 220-691: WORK ITEMS tools
- Lines 693-774: COMMENTS tools
- Lines 776-929: ATTACHMENTS tools
- Lines 932-1191: PROMPTS
- Lines 1229-1278: RESOURCES

[NEW SECTION TO ADD]
- Lines ~930-????: AZURE REPOS (Git) tools
```

#### State Management Pattern

**New module-level variable (after line 86):**
```typescript
let gitApiClient: gitApi.IGitApi | null = null;
```

**New getter function (after line 139):**
```typescript
async function getGitApi(): Promise<gitApi.IGitApi> {
  if (!gitApiClient) {
    const conn = await getConnection();
    gitApiClient = await conn.getGitApi();
  }
  return gitApiClient;
}
```

**Reset on reconfiguration (line 197, in ado_configure):**
```typescript
gitApiClient = null;
```

### 3.2 Tool Naming Convention

All tools follow the pattern: `ado_<verb>_<noun>`

- Existing: `ado_configure`, `ado_get_work_item`, `ado_create_work_item`
- New: `ado_list_repositories`, `ado_list_pull_requests`, `ado_approve_pull_request`

### 3.3 Return Format

All tools return:
```typescript
{
  content: [{
    type: "text",
    text: "<formatted response>"
  }]
}
```

Formatting functions should be added for complex types (PRs, repositories, etc.).

---

## 4. Detailed Tool Specifications

### 4.1 Repository Tools

#### Tool 1: `ado_list_repositories`

**Purpose**: List all Git repositories in the project.

**Input Schema (Zod)**:
```typescript
{
  includeHidden: z.boolean().optional().describe("Include hidden repositories"),
  top: z.number().optional().describe("Maximum number to return (default: 100)")
}
```

**Implementation**:
```typescript
const api = await getGitApi();
const repos = await api.getRepositories(
  currentProject,
  undefined,  // includeLinks
  undefined,  // includeAllUrls
  includeHidden
);
// Limit to 'top' if provided
const limited = top ? repos.slice(0, top) : repos;
return formatRepositoryList(limited);
```

**Format Output**:
```typescript
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
```

---

#### Tool 2: `ado_get_repository`

**Purpose**: Get details of a specific repository by name or ID.

**Input Schema (Zod)**:
```typescript
{
  repositoryId: z.string().describe("Repository name or ID")
}
```

**Implementation**:
```typescript
const api = await getGitApi();
const repo = await api.getRepository(repositoryId, currentProject);
return formatRepository(repo);
```

**Format Output**:
```typescript
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
```

---

#### Tool 3: `ado_list_branches`

**Purpose**: List all branches in a repository.

**Input Schema (Zod)**:
```typescript
{
  repositoryId: z.string().describe("Repository name or ID"),
  filter: z.string().optional().describe("Filter by name substring"),
  includeStatuses: z.boolean().optional().describe("Include branch statuses")
}
```

**Implementation**:
```typescript
const api = await getGitApi();
const refs = await api.getRefs(
  repositoryId,
  currentProject,
  "heads/",      // Only branches
  undefined,
  includeStatuses
);
// Apply filter if provided
const filtered = filter
  ? refs.filter(r => r.name?.toLowerCase().includes(filter.toLowerCase()))
  : refs;
return formatBranchList(filtered);
```

**Format Output**:
```typescript
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
```

---

### 4.2 Pull Request CRUD Tools

#### Tool 4: `ado_list_pull_requests`

**Purpose**: List pull requests with optional filters. Can search by repository or project-wide.

**Input Schema (Zod)**:
```typescript
{
  repositoryId: z.string().optional().describe("Repository name or ID (omit for project-wide search)"),
  status: z.enum(["Active", "Completed", "Abandoned", "All"]).optional().describe("Filter by status"),
  sourceRefName: z.string().optional().describe("Filter by source branch (e.g., 'refs/heads/feature-1')"),
  targetRefName: z.string().optional().describe("Filter by target branch"),
  creatorId: z.string().optional().describe("Filter by creator identity ID"),
  reviewerId: z.string().optional().describe("Filter by reviewer identity ID"),
  top: z.number().optional().describe("Maximum number to return (default: 100)")
}
```

**Implementation**:
```typescript
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
    undefined,  // maxCommentLength
    undefined,  // skip
    top
  );
} else {
  // Project-wide search
  prs = await api.getPullRequestsByProject(
    currentProject,
    searchCriteria,
    undefined,  // maxCommentLength
    undefined,  // skip
    top
  );
}

return formatPullRequestList(prs);
```

**Format Output**:
```typescript
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
```

---

#### Tool 5: `ado_get_pull_request`

**Purpose**: Get complete details of a specific pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID (optional if using project-wide access)"),
  includeCommits: z.boolean().optional().describe("Include PR commits"),
  includeWorkItems: z.boolean().optional().describe("Include linked work items")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

let pr: gitInterfaces.GitPullRequest;

if (repositoryId) {
  pr = await api.getPullRequest(
    repositoryId,
    pullRequestId,
    currentProject,
    undefined,  // maxCommentLength
    undefined,  // skip
    undefined,  // top
    includeCommits,
    includeWorkItems
  );
} else {
  pr = await api.getPullRequestById(pullRequestId, currentProject);
}

return formatPullRequest(pr);
```

**Format Output**:
```typescript
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
```

---

#### Tool 6: `ado_create_pull_request`

**Purpose**: Create a new pull request.

**Input Schema (Zod)**:
```typescript
{
  repositoryId: z.string().describe("Repository name or ID"),
  sourceRefName: z.string().describe("Source branch (e.g., 'refs/heads/feature-1')"),
  targetRefName: z.string().describe("Target branch (e.g., 'refs/heads/main')"),
  title: z.string().describe("Pull request title"),
  description: z.string().optional().describe("Pull request description"),
  reviewerIds: z.array(z.string()).optional().describe("List of reviewer identity IDs"),
  isDraft: z.boolean().optional().describe("Create as draft")
}
```

**Implementation**:
```typescript
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
  } as VSSInterfaces.IdentityRefWithVote));
}

const pr = await api.createPullRequest(prToCreate, repositoryId, currentProject);

return {
  content: [{
    type: "text",
    text: `Pull Request creado exitosamente.\n\n${formatPullRequest(pr)}`
  }]
};
```

---

#### Tool 7: `ado_update_pull_request`

**Purpose**: Update pull request properties (title, description, draft status).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description"),
  isDraft: z.boolean().optional().describe("Set draft status")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

const update: gitInterfaces.GitPullRequest = {};

if (title !== undefined) update.title = title;
if (description !== undefined) update.description = description;
if (isDraft !== undefined) update.isDraft = isDraft;

const pr = repositoryId
  ? await api.updatePullRequest(update, repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject); // Get repo ID first, then update

return {
  content: [{
    type: "text",
    text: `Pull Request actualizado exitosamente.\n\n${formatPullRequest(pr)}`
  }]
};
```

---

#### Tool 8: `ado_complete_pull_request`

**Purpose**: Complete (merge) a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  mergeStrategy: z.enum(["NoFastForward", "Squash", "Rebase", "RebaseMerge"]).optional().describe("Merge strategy (default: NoFastForward)"),
  deleteSourceBranch: z.boolean().optional().describe("Delete source branch after merge"),
  transitionWorkItems: z.boolean().optional().describe("Transition linked work items"),
  mergeCommitMessage: z.string().optional().describe("Custom merge commit message")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

// Get current PR first to get lastMergeSourceCommit
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
```

---

#### Tool 9: `ado_abandon_pull_request`

**Purpose**: Abandon a pull request (change status to Abandoned).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID")
}
```

**Implementation**:
```typescript
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
```

---

### 4.3 Pull Request Review Tools

#### Tool 10: `ado_approve_pull_request`

**Purpose**: Approve a pull request (vote: 10).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  reviewerId: z.string().optional().describe("Identity ID of the approver (defaults to authenticated user if available)")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

// Get current PR to get repository
const currentPr = repositoryId
  ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject);

const repositoryIdActual = repositoryId || currentPr.repository?.id!;

// If reviewerId not provided, try to get from connection
let actualReviewerId = reviewerId;
if (!actualReviewerId) {
  // Try to get authenticated user ID from connection
  const conn = await getConnection();
  const connData = await conn.connect();
  actualReviewerId = connData.authenticatedUser?.id;
  if (!actualReviewerId) {
    throw new Error("Cannot determine authenticated user ID. Please provide reviewerId explicitly.");
  }
}

const reviewer: VSSInterfaces.IdentityRefWithVote = {
  id: actualReviewerId,
  vote: 10  // Approved
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
```

**Format Output**:
```typescript
function formatReviewer(reviewer: VSSInterfaces.IdentityRefWithVote): string {
  return JSON.stringify({
    displayName: reviewer.displayName,
    vote: reviewer.vote,
    voteLabel: getVoteLabel(reviewer.vote),
    isRequired: reviewer.isRequired,
    hasDeclined: reviewer.hasDeclined
  }, null, 2);
}
```

---

#### Tool 11: `ado_reject_pull_request`

**Purpose**: Reject a pull request (vote: -10).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  reviewerId: z.string().optional().describe("Identity ID of the reviewer (defaults to authenticated user if available)")
}
```

**Implementation**:
```typescript
// Same as approve, but with vote: -10
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

const reviewer: VSSInterfaces.IdentityRefWithVote = {
  id: actualReviewerId,
  vote: -10  // Rejected
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
```

---

#### Tool 12: `ado_get_pull_request_reviewers`

**Purpose**: Get all reviewers and their votes for a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID")
}
```

**Implementation**:
```typescript
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

return formatReviewerList(reviewers);
```

**Format Output**:
```typescript
function formatReviewerList(reviewers: VSSInterfaces.IdentityRefWithVote[]): string {
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
```

---

#### Tool 13: `ado_add_pull_request_reviewer`

**Purpose**: Add a reviewer to a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  reviewerId: z.string().describe("Identity ID of the reviewer to add"),
  vote: z.number().optional().describe("Initial vote value (default: 0 = no vote)")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

const currentPr = repositoryId
  ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject);

const repositoryIdActual = repositoryId || currentPr.repository?.id!;

const reviewer: VSSInterfaces.IdentityRefWithVote = {
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
```

---

### 4.4 Pull Request Comment Tools

#### Tool 14: `ado_get_pull_request_threads`

**Purpose**: Get all comment threads for a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

const currentPr = repositoryId
  ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject);

const repositoryIdActual = repositoryId || currentPr.repository?.id!;

const threads = await api.getThreads(repositoryIdActual, pullRequestId, currentProject);

return formatThreadList(threads);
```

**Format Output**:
```typescript
function formatThreadList(threads: gitInterfaces.GitPullRequestCommentThread[]): string {
  return JSON.stringify(threads.map(t => ({
    id: t.id,
    status: gitInterfaces.CommentThreadStatus[t.status || 0],
    filePath: t.pullRequestThreadContext?.filePath,
    position: t.pullRequestThreadContext
      ? {
          startLine: t.pullRequestThreadContext.rightFileStart?.line,
          endLine: t.pullRequestThreadContext.rightFileEnd?.line
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
```

---

#### Tool 15: `ado_create_pull_request_thread`

**Purpose**: Create a new comment thread (general comment or code comment).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  content: z.string().describe("Comment content"),
  filePath: z.string().optional().describe("File path for code comment (optional for general comment)"),
  startLine: z.number().optional().describe("Start line for code comment (1-indexed)"),
  endLine: z.number().optional().describe("End line for code comment (1-indexed)")
}
```

**Implementation**:
```typescript
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

// Add file position if provided
if (filePath && startLine !== undefined) {
  thread.pullRequestThreadContext = {
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
```

---

#### Tool 16: `ado_reply_to_pull_request_thread`

**Purpose**: Reply to an existing comment thread.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  threadId: z.number().describe("Thread ID to reply to"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  content: z.string().describe("Reply content")
}
```

**Implementation**:
```typescript
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

// Get updated thread
const updatedThread = await api.getPullRequestThread(repositoryIdActual, pullRequestId, threadId, currentProject);

return {
  content: [{
    type: "text",
    text: `Respuesta agregada exitosamente.\n\n${formatThreadList([updatedThread])}`
  }]
};
```

---

### 4.5 Pull Request Info Tools

#### Tool 17: `ado_get_pull_request_commits`

**Purpose**: Get all commits for a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  top: z.number().optional().describe("Maximum number to return (default: 100)")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

const currentPr = repositoryId
  ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject);

const repositoryIdActual = repositoryId || currentPr.repository?.id!;

let commits = await api.getPullRequestCommits(repositoryIdActual, pullRequestId, currentProject);

// Handle PagedList
const commitArray: gitInterfaces.GitCommitRef[] = [];
for await (const commit of commits) {
  commitArray.push(commit);
  if (top && commitArray.length >= top) break;
}

return formatCommitList(commitArray);
```

**Format Output**:
```typescript
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
```

---

#### Tool 18: `ado_get_pull_request_work_items`

**Purpose**: Get work items linked to a pull request.

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  repositoryId: z.string().optional().describe("Repository name or ID")
}
```

**Implementation**:
```typescript
const api = await getGitApi();

const currentPr = repositoryId
  ? await api.getPullRequest(repositoryId, pullRequestId, currentProject)
  : await api.getPullRequestById(pullRequestId, currentProject);

const repositoryIdActual = repositoryId || currentPr.repository?.id!;

const workItems = await api.getPullRequestWorkItemRefs(repositoryIdActual, pullRequestId, currentProject);

// Optionally get full work item details
const witApi = await getWitApi();
const ids = workItems.map(wi => parseInt(wi.id!)).filter(id => !isNaN(id));
const fullItems = ids.length > 0 ? await witApi.getWorkItems(ids, ["System.Id", "System.Title", "System.WorkItemType", "System.State"]) : [];

return JSON.stringify(fullItems.map(wi => ({
  id: wi.id,
  title: wi.fields?.["System.Title"],
  type: wi.fields?.["System.WorkItemType"],
  state: wi.fields?.["System.State"],
  url: wi.url
})), null, 2);
```

---

#### Tool 19: `ado_update_pull_request_thread_status`

**Purpose**: Update the status of a comment thread (e.g., mark as Fixed, WontFix, etc.).

**Input Schema (Zod)**:
```typescript
{
  pullRequestId: z.number().describe("Pull request ID"),
  threadId: z.number().describe("Thread ID"),
  repositoryId: z.string().optional().describe("Repository name or ID"),
  status: z.enum(["Active", "Fixed", "WontFix", "Closed", "ByDesign", "Pending"]).describe("New thread status")
}
```

**Implementation**:
```typescript
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
```

---

## 5. Implementation Notes

### 5.1 Error Handling

All tools should:
1. Use try-catch blocks for API calls
2. Wrap errors with descriptive messages
3. Return error information in the response content
4. Use consistent error format

```typescript
try {
  // API calls
  return { content: [{ type: "text", text: "success..." }] };
} catch (error: any) {
  return {
    content: [{
      type: "text",
      text: `Error: ${error.message}\n\nDetails: ${JSON.stringify(error, null, 2)}`
    }],
    isError: true
  };
}
```

### 5.2 Helper Functions to Add

**After line 174 (after existing formatWorkItemList)**:

```typescript
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
function formatRepository(repo: gitInterfaces.GitRepository): string { /* ... */ }

// Helper para formatear lista de repositorios
function formatRepositoryList(repos: gitInterfaces.GitRepository[]): string { /* ... */ }

// Helper para formatear lista de branches
function formatBranchList(refs: gitInterfaces.GitRef[]): string { /* ... */ }

// Helper para formatear Pull Request
function formatPullRequest(pr: gitInterfaces.GitPullRequest): string { /* ... */ }

// Helper para formatear lista de Pull Requests
function formatPullRequestList(prs: gitInterfaces.GitPullRequest[]): string { /* ... */ }

// Helper para formatear reviewer
function formatReviewer(reviewer: VSSInterfaces.IdentityRefWithVote): string { /* ... */ }

// Helper para formatear lista de reviewers
function formatReviewerList(reviewers: VSSInterfaces.IdentityRefWithVote[]): string { /* ... */ }

// Helper para formatear lista de hilos
function formatThreadList(threads: gitInterfaces.GitPullRequestCommentThread[]): string { /* ... */ }

// Helper para formatear lista de commits
function formatCommitList(commits: gitInterfaces.GitCommitRef[]): string { /* ... */ }
```

### 5.3 Import Statements to Add

**After line 10 (after VSSInterfaces import)**:

```typescript
import * as gitApi from "azure-devops-node-api/GitApi";
import * as gitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces";
```

### 5.4 Authentication Considerations

**PAT Permissions Required**:
The PAT used for connection must have the following scopes:
- **Code**: Read & Write (for all Git operations)

**Update connection error message** (in `getConnection`, line ~91-117):

Add note about Code scope:

```typescript
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
  4. Copia el token y guárdalo en un lugar seguro

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
```

---

## 6. Testing Strategy

### 6.1 Unit Testing (Future Enhancement)
Currently, the project has no test framework. For future testing:
- Consider adding Jest or Vitest
- Mock `azure-devops-node-api` responses
- Test formatting functions with sample data

### 6.2 Manual Testing Checklist

**Connection**:
- [ ] `ado_configure` resets Git API client correctly

**Repositories**:
- [ ] `ado_list_repositories` returns correct count
- [ ] `ado_get_repository` retrieves by name and ID
- [ ] `ado_list_branches` filters correctly

**Pull Requests**:
- [ ] `ado_list_pull_requests` with status filter works
- [ ] `ado_list_pull_requests` project-wide search works
- [ ] `ado_get_pull_request` returns all details
- [ ] `ado_create_pull_request` creates successfully
- [ ] `ado_update_pull_request` modifies fields
- [ ] `ado_complete_pull_request` merges with strategy
- [ ] `ado_abandon_pull_request` changes status

**Reviews**:
- [ ] `ado_approve_pull_request` sets vote to 10
- [ ] `ado_reject_pull_request` sets vote to -10
- [ ] `ado_get_pull_request_reviewers` lists all reviewers
- [ ] `ado_add_pull_request_reviewer` adds reviewer

**Comments**:
- [ ] `ado_get_pull_request_threads` returns all threads
- [ ] `ado_create_pull_request_thread` creates general comment
- [ ] `ado_create_pull_request_thread` creates code comment with position
- [ ] `ado_reply_to_pull_request_thread` adds reply
- [ ] `ado_update_pull_request_thread_status` changes status

**Info**:
- [ ] `ado_get_pull_request_commits` lists commits
- [ ] `ado_get_pull_request_work_items` links work items

### 6.3 Integration Testing
- Test with real Azure DevOps organization
- Verify PAT permissions work correctly
- Test error scenarios (invalid repo, invalid PR ID, etc.)

---

## 7. Post-Implementation Tasks

### 7.1 Documentation Updates
- Update `README.md` with new tools list
- Add example MCP configuration
- Update PAT permission requirements

### 7.2 Version Update
- Update `package.json` version to `2.4.0` (minor version increment)
- Update any changelog if maintained

### 7.3 Build and Test
```bash
npm run build
npm start
```

### 7.4 Publishing
```bash
npm publish
```

---

## 8. Future Enhancements (Out of Scope for V1)

1. **Pipelines API**: List builds, queue builds, get build status
2. **Repository Management**: Create/delete repositories
3. **Branch Management**: Create/delete branches, lock/unlock
4. **Tags API**: Create tags, list tags
5. **File Content API**: Get file content from PR diff
6. **Status Checks**: Query policy evaluation status
7. **Batch Operations**: Approve multiple PRs, add multiple reviewers
8. **Prompts**: Add MCP prompts for common workflows (review PRs, daily standup, etc.)

---

## 9. Success Criteria

The implementation is considered complete when:
- ✅ All 19 tools are implemented in `src/index.ts`
- ✅ All tools follow the existing code patterns and naming conventions
- ✅ All tools return properly formatted responses
- ✅ `npm run build` completes without errors
- ✅ Manual testing of each tool succeeds
- ✅ No breaking changes to existing functionality
- ✅ README.md is updated with new tool documentation

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **PR** | Pull Request |
| **PAT** | Personal Access Token |
| **MCP** | Model Context Protocol |
| **SDK** | Software Development Kit |
| **WIQL** | Work Item Query Language |
| **Repo** | Repository |
| **Ref** | Git reference (branch or tag) |
| **Commit** | Git commit |
| **Thread** | Comment thread in a PR |
| **Reviewer** | User assigned to review a PR |
| **Vote** | Numeric vote value (-10 to 10) for PR approval |

---

## 11. References

- [Azure DevOps Node.js API Documentation](https://github.com/Microsoft/azure-devops-node-api)
- [Azure DevOps REST API - Git](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Existing MCP Azure README](./README.md)

---

## Appendix A: Complete Implementation Template

Below is the complete code block to be inserted into `src/index.ts` after line 929 (after ATTACHMENTS section):

```typescript
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
        } as VSSInterfaces.IdentityRefWithVote));
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

      const reviewer: VSSInterfaces.IdentityRefWithVote = {
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

      const reviewer: VSSInterfaces.IdentityRefWithVote = {
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

      const reviewer: VSSInterfaces.IdentityRefWithVote = {
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
        thread.pullRequestThreadContext = {
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
```

---

## Appendix B: Helper Functions Implementation Template

Add these helper functions after line 174 (after `formatWorkItemList`):

```typescript
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
function formatReviewer(reviewer: VSSInterfaces.IdentityRefWithVote): string {
  return JSON.stringify({
    displayName: reviewer.displayName,
    vote: reviewer.vote,
    voteLabel: getVoteLabel(reviewer.vote),
    isRequired: reviewer.isRequired,
    hasDeclined: reviewer.hasDeclined
  }, null, 2);
}

// Helper para formatear lista de reviewers
function formatReviewerList(reviewers: VSSInterfaces.IdentityRefWithVote[]): string {
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
    filePath: t.pullRequestThreadContext?.filePath,
    position: t.pullRequestThreadContext
      ? {
          startLine: t.pullRequestThreadContext.rightFileStart?.line,
          endLine: t.pullRequestThreadContext.rightFileEnd?.line
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
```

---

## Appendix C: Import Statements Template

Add these imports after line 10:

```typescript
import * as gitApi from "azure-devops-node-api/GitApi";
import * as gitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces";
```

---

## Appendix D: State Management Updates Template

### 1. Add module variable after line 86:
```typescript
let gitApiClient: gitApi.IGitApi | null = null;
```

### 2. Add getter function after line 139:
```typescript
async function getGitApi(): Promise<gitApi.IGitApi> {
  if (!gitApiClient) {
    const conn = await getConnection();
    gitApiClient = await conn.getGitApi();
  }
  return gitApiClient;
}
```

### 3. Add reset in `ado_configure` after line 197:
```typescript
gitApiClient = null;
```

### 4. Find `autoConfigureFromEnv` function and add reset there too:
```typescript
// Reset all API clients
workItemTrackingApi = null;
coreApiClient = null;
gitApiClient = null;  // <-- Add this line
```

---

## Appendix E: Connection Error Message Update Template

Update the error message in `getConnection` function (lines 91-117) to include Code scope information:

```typescript
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
  4. Copia el token y guárdalo en un lugar seguro

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
```

---

**End of PRD v1.0**
