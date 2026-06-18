import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const employeeLevelEnum = pgEnum('employee_level', ['junior', 'mid', 'senior', 'staff']);
export const userRoleEnum = pgEnum('user_role', ['system_admin', 'exam_creator', 'reviewer', 'employee']);
export const examStatusEnum = pgEnum('exam_status', ['draft', 'published', 'closed']);
export const submissionStatusEnum = pgEnum('submission_status', [
  'pending', 'processing', 'sandbox_done', 'ai_graded', 'review_pending', 'completed',
]);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'processing', 'completed', 'failed']);
export const sandboxPhaseEnum = pgEnum('sandbox_phase', ['clone', 'install', 'run']);
export const notificationTypeEnum = pgEnum('notification_type', ['published', 'reminder', 'result']);
export const notificationStatusEnum = pgEnum('notification_delivery_status', ['sent', 'failed']);
export const appealStatusEnum = pgEnum('appeal_status', ['pending', 'reviewing', 'closed']);
export const plagiarismCheckTypeEnum = pgEnum('plagiarism_check_type', [
  'ast_similarity', 'git_pattern', 'deploy_fingerprint',
]);
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'disabled', 'left']);
export const examAssignmentStatusEnum = pgEnum('exam_assignment_status', ['assigned', 'voided']);

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  dingtalkUserid: text('dingtalk_userid').notNull().unique(),
  name: text('name').notNull(),
  department: text('department'),
  level: employeeLevelEnum('level').notNull().default('junior'),
  status: employeeStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  role: userRoleEnum('role').notNull(),
}, (t) => [uniqueIndex('user_roles_employee_role_idx').on(t.employeeId, t.role)]);

export const exams = pgTable('exams', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  background: text('background').notNull(),
  runCommand: text('run_command').notNull(),
  installCommand: text('install_command'),
  status: examStatusEnum('status').notNull().default('draft'),
  deadline: timestamp('deadline', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => employees.id),
  needsOwnerTransfer: boolean('needs_owner_transfer').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rubricItems = pgTable('rubric_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id),
  name: text('name').notNull(),
  weight: integer('weight').notNull(),
  criteriaText: text('criteria_text').notNull(),
  isCore: boolean('is_core').notNull().default(false),
  hiddenNotes: text('hidden_notes'),
  orderIndex: integer('order_index').notNull().default(0),
});

export const levelThresholds = pgTable('level_thresholds', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id),
  level: employeeLevelEnum('level').notNull(),
  passScore: numeric('pass_score', { precision: 5, scale: 2 }).notNull(),
}, (t) => [uniqueIndex('level_thresholds_exam_level_idx').on(t.examId, t.level)]);

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  deployUrl: text('deploy_url').notNull(),
  repoUrl: text('repo_url').notNull(),
  assumptionDocUrl: text('assumption_doc_url'),
  assumptionText: text('assumption_text'),
  gitTokenEncrypted: text('git_token_encrypted'),
  status: submissionStatusEnum('status').notNull().default('pending'),
  version: integer('version').notNull().default(1),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissionHistory = pgTable('submission_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gradingTasks = pgTable('grading_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  status: taskStatusEnum('status').notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const autoCheckResults = pgTable('auto_check_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  checkName: text('check_name').notNull(),
  passed: boolean('passed').notNull(),
  rawOutput: text('raw_output'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sandboxRunResults = pgTable('sandbox_run_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  phase: sandboxPhaseEnum('phase').notNull(),
  returncode: integer('returncode').notNull(),
  stdout: text('stdout'),
  stderr: text('stderr'),
  durationSeconds: numeric('duration_seconds', { precision: 8, scale: 2 }),
  timedOut: boolean('timed_out').notNull().default(false),
  oomKilled: boolean('oom_killed').notNull().default(false),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sandbox_run_results_submission_phase_idx').on(t.submissionId, t.phase)]);

export const promptVersions = pgTable('prompt_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id),
  version: integer('version').notNull(),
  promptTemplate: text('prompt_template').notNull(),
  modelId: text('model_id').notNull(),
  rubricSnapshot: jsonb('rubric_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
}, (t) => [uniqueIndex('prompt_versions_exam_version_idx').on(t.examId, t.version)]);

export const aiGradingResults = pgTable('ai_grading_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  rubricItemId: uuid('rubric_item_id').notNull().references(() => rubricItems.id),
  promptVersionId: uuid('prompt_version_id').notNull().references(() => promptVersions.id),
  score: numeric('score', { precision: 5, scale: 2 }).notNull(),
  maxScore: numeric('max_score', { precision: 5, scale: 2 }).notNull(),
  reasoning: text('reasoning'),
  evidenceRef: jsonb('evidence_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const humanReviews = pgTable('human_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id).unique(),
  reviewerId: uuid('reviewer_id').notNull().references(() => employees.id),
  finalScore: numeric('final_score', { precision: 5, scale: 2 }).notNull(),
  adjustedItems: jsonb('adjusted_items'),
  comment: text('comment'),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appeals = pgTable('appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  appellantId: uuid('appellant_id').notNull().references(() => employees.id),
  reason: text('reason').notNull(),
  status: appealStatusEnum('status').notNull().default('pending'),
  secondReviewerId: uuid('second_reviewer_id').references(() => employees.id),
  secondReviewScore: numeric('second_review_score', { precision: 5, scale: 2 }),
  secondReviewComment: text('second_review_comment'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  type: notificationTypeEnum('type').notNull(),
  examId: uuid('exam_id').references(() => exams.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  dingtalkTaskId: text('dingtalk_task_id'),
  status: notificationStatusEnum('status').notNull().default('sent'),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => employees.id),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  payloadDiff: jsonb('payload_diff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const revokedTokens = pgTable('revoked_tokens', {
  jti: text('jti').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const plagiarismChecks = pgTable('plagiarism_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  checkType: plagiarismCheckTypeEnum('check_type').notNull(),
  score: numeric('score', { precision: 5, scale: 2 }),
  detail: jsonb('detail'),
  flagged: boolean('flagged').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const examAssignments = pgTable('exam_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  status: examAssignmentStatusEnum('status').notNull().default('assigned'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
}, (t) => [uniqueIndex('exam_assignments_exam_employee_idx').on(t.examId, t.employeeId)]);
