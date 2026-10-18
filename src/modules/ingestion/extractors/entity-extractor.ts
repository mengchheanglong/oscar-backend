import { ExtractedDocument } from './text-extractor.interface';

export class EntityExtractor {
  extractDecision(decision: {
    id: string;
    title: string;
    status?: string;
    category?: string;
    context?: string | null;
    decision?: string | null;
    consequences?: string | null;
  }): ExtractedDocument {
    const lines: string[] = [
      `Decision: ${decision.title}`,
      `Status: ${decision.status ?? 'N/A'} | Category: ${decision.category ?? 'N/A'}`,
    ];

    const sections: { title?: string; content: string }[] = [];

    if (decision.context) {
      lines.push(`\nContext:\n${decision.context}`);
      sections.push({ title: 'Context', content: decision.context });
    }

    if (decision.decision) {
      lines.push(`\nDecision Taken:\n${decision.decision}`);
      sections.push({ title: 'Decision Taken', content: decision.decision });
    }

    if (decision.consequences) {
      lines.push(`\nConsequences:\n${decision.consequences}`);
      sections.push({ title: 'Consequences', content: decision.consequences });
    }

    const text = lines.join('\n');
    return {
      text,
      sections: sections.length > 0 ? sections : [{ content: text }],
      metadata: {
        charCount: text.length,
        sourceType: 'DECISION',
        sourceId: decision.id,
        title: decision.title,
      },
    };
  }

  extractTask(task: {
    id: string;
    title: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | Date | null;
  }): ExtractedDocument {
    const lines: string[] = [
      `Task: ${task.title}`,
      `Status: ${task.status ?? 'N/A'} | Priority: ${task.priority ?? 'N/A'} | Due: ${task.dueDate ? new Date(task.dueDate).toISOString() : 'None'}`,
    ];

    const sections: { title?: string; content: string }[] = [];

    if (task.description) {
      lines.push(`\nDescription:\n${task.description}`);
      sections.push({ title: 'Description', content: task.description });
    }

    const text = lines.join('\n');
    return {
      text,
      sections: sections.length > 0 ? sections : [{ content: text }],
      metadata: {
        charCount: text.length,
        sourceType: 'TASK',
        sourceId: task.id,
        title: task.title,
      },
    };
  }

  extractGitHubIssue(issue: {
    id: string;
    issueNumber: number;
    title: string;
    body?: string | null;
    state: string;
    htmlUrl: string;
    authorLogin?: string | null;
    labels?: string[] | null;
    repositoryOwner?: string;
    repositoryName?: string;
    comments?: Array<{ authorLogin?: string | null; body: string }>;
  }): ExtractedDocument {
    const repoInfo =
      issue.repositoryOwner && issue.repositoryName
        ? ` (${issue.repositoryOwner}/${issue.repositoryName})`
        : '';
    const lines: string[] = [
      `GitHub Issue #${issue.issueNumber}: ${issue.title}${repoInfo}`,
      `State: ${issue.state.toUpperCase()} | Author: ${issue.authorLogin ?? 'Unknown'} | URL: ${issue.htmlUrl}`,
    ];

    if (issue.labels && issue.labels.length > 0) {
      lines.push(`Labels: ${issue.labels.join(', ')}`);
    }

    const sections: { title?: string; content: string }[] = [];

    if (issue.body) {
      lines.push(`\nDescription:\n${issue.body}`);
      sections.push({ title: 'Description', content: issue.body });
    }

    if (issue.comments && issue.comments.length > 0) {
      lines.push(`\nDiscussion (${issue.comments.length} comments):`);
      for (const comment of issue.comments) {
        const commentAuthor = comment.authorLogin ?? 'Anonymous';
        lines.push(`- @${commentAuthor}: ${comment.body}`);
        sections.push({
          title: `Comment by @${commentAuthor}`,
          content: comment.body,
        });
      }
    }

    const text = lines.join('\n');
    return {
      text,
      sections: sections.length > 0 ? sections : [{ content: text }],
      metadata: {
        charCount: text.length,
        sourceType: 'GITHUB_ISSUE',
        sourceId: issue.id,
        title: `[GitHub #${issue.issueNumber}] ${issue.title}`,
      },
    };
  }

  extractGitHubPullRequest(pr: {
    id: string;
    prNumber: number;
    title: string;
    body?: string | null;
    state: string;
    htmlUrl: string;
    authorLogin?: string | null;
    baseBranch?: string | null;
    headBranch?: string | null;
    isMerged?: boolean;
    labels?: string[] | null;
    repositoryOwner?: string;
    repositoryName?: string;
  }): ExtractedDocument {
    const repoInfo =
      pr.repositoryOwner && pr.repositoryName
        ? ` (${pr.repositoryOwner}/${pr.repositoryName})`
        : '';
    const lines: string[] = [
      `GitHub Pull Request #${pr.prNumber}: ${pr.title}${repoInfo}`,
      `State: ${pr.state.toUpperCase()} | Merged: ${pr.isMerged ? 'YES' : 'NO'} | Author: ${pr.authorLogin ?? 'Unknown'} | Branches: ${pr.headBranch ?? 'head'} -> ${pr.baseBranch ?? 'base'} | URL: ${pr.htmlUrl}`,
    ];

    if (pr.labels && pr.labels.length > 0) {
      lines.push(`Labels: ${pr.labels.join(', ')}`);
    }

    const sections: { title?: string; content: string }[] = [];

    if (pr.body) {
      lines.push(`\nPull Request Overview:\n${pr.body}`);
      sections.push({ title: 'Overview', content: pr.body });
    }

    const text = lines.join('\n');
    return {
      text,
      sections: sections.length > 0 ? sections : [{ content: text }],
      metadata: {
        charCount: text.length,
        sourceType: 'GITHUB_PR',
        sourceId: pr.id,
        title: `[GitHub PR #${pr.prNumber}] ${pr.title}`,
      },
    };
  }

  extractGitHubCodeFile(file: {
    id: string;
    path: string;
    fileName: string;
    extension: string;
    content: string;
    size: number;
    repositoryOwner?: string;
    repositoryName?: string;
    htmlUrl: string;
  }): ExtractedDocument {
    const repoInfo =
      file.repositoryOwner && file.repositoryName
        ? `${file.repositoryOwner}/${file.repositoryName}`
        : 'Repository';
    const lines: string[] = [
      `Code File: ${file.path} (${repoInfo})`,
      `Type: ${file.extension.toUpperCase()} | Size: ${file.size} bytes | URL: ${file.htmlUrl}`,
      `\nSource Code:\n${file.content}`,
    ];

    const text = lines.join('\n');
    return {
      text,
      sections: [{ title: file.path, content: file.content }],
      metadata: {
        charCount: text.length,
        sourceType: 'GITHUB_CODE',
        sourceId: file.id,
        title: `[Code] ${file.path}`,
      },
    };
  }
}
