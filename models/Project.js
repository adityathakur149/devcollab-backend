const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Project Schema for DevCollab collaborative coding sessions.
 * Each project has a unique roomId that collaborators use to join.
 */
const ProjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      minlength: [1, 'Project name cannot be empty'],
      maxlength: [100, 'Project name cannot exceed 100 characters'],
    },
    language: {
      type: String,
      default: 'javascript',
      enum: [
        'javascript',
        'typescript',
        'python',
        'java',
        'cpp',
        'c',
        'csharp',
        'go',
        'rust',
        'html',
        'css',
        'json',
        'markdown',
        'sql',
        'php',
        'ruby',
        'swift',
      ],
    },
    code: {
      type: String,
      default: '// Start collaborating here!\n',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    collaborators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    roomId: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(6).toString('hex'), // 12-char hex room code
    },
    lastEditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    messages: [
      {
        id: String,
        user: {
          _id: String,
          username: String,
          avatarColor: String,
        },
        text: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

/**
 * Index for fast lookups by owner and collaborator membership
 */
ProjectSchema.index({ owner: 1 });
ProjectSchema.index({ collaborators: 1 });

module.exports = mongoose.model('Project', ProjectSchema);
