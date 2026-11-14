const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const { protect } = require('../middleware/auth');
const Project = require('../models/Project');

// In-memory fallback store for dev testing when MongoDB is offline
const inMemoryProjects = [];

const isDbConnected = () => mongoose.connection.readyState === 1;

const ALLOWED_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp', 'c',
  'csharp', 'go', 'rust', 'html', 'css', 'json', 'markdown', 'sql', 'php', 'ruby', 'swift'
];

const validateProjectInput = (req, res, next) => {
  const { name, language, code } = req.body;

  if (name !== undefined) {
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Project name must be a non-empty string' });
    }
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      return res.status(400).json({ message: 'Project name cannot be empty' });
    }
    if (trimmed.length > 100) {
      return res.status(400).json({ message: 'Project name cannot exceed 100 characters' });
    }
    req.body.name = trimmed;
  }

  if (language !== undefined) {
    if (!language || typeof language !== 'string') {
      return res.status(400).json({ message: 'Language must be a string' });
    }
    const lang = language.toLowerCase();
    if (!ALLOWED_LANGUAGES.includes(lang)) {
      return res.status(400).json({ message: `Invalid language. Allowed: ${ALLOWED_LANGUAGES.join(', ')}` });
    }
    req.body.language = lang;
  }

  if (code !== undefined) {
    if (typeof code !== 'string') {
      return res.status(400).json({ message: 'Code must be a string' });
    }
    if (code.length > 500000) { // ~500KB limit
      return res.status(400).json({ message: 'Code exceeds maximum size (500KB)' });
    }
  }

  next();
};

const validateRoomId = (req, res, next) => {
  const { roomId } = req.params;
  if (!roomId || !/^[a-f0-9]{12}$/i.test(roomId)) {
    return res.status(400).json({ message: 'Invalid room ID format' });
  }
  next();
};

const DEFAULT_TEMPLATES = {
  javascript: '// Welcome to DevCollab!\nconsole.log("Hello from DevCollab!");\n',
  typescript: 'const greeting: string = "Hello from DevCollab!";\nconsole.log(greeting);\n',
  python: 'def main():\n    print("Hello from DevCollab!")\n\nif __name__ == "__main__":\n    main()\n',
  c: '#include <stdio.h>\n\nint main() {\n    printf("Hello from DevCollab!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello from DevCollab!" << endl;\n    return 0;\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from DevCollab!");\n    }\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello from DevCollab!")\n}\n',
  rust: 'fn main() {\n    println!("Hello from DevCollab!");\n}\n',
  csharp: 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello from DevCollab!");\n    }\n}\n',
};

/**
 * @route   POST /api/projects
 * @desc    Create a new project
 * @access  Private
 */
router.post('/', protect, validateProjectInput, async (req, res) => {
  try {
    const { name, language } = req.body;

    const selectedLang = (language || 'javascript').toLowerCase();
    const initialCode = DEFAULT_TEMPLATES[selectedLang] || `// ${name}\n`;

    if (isDbConnected()) {
      const project = await Project.create({
        name,
        language: selectedLang,
        code: initialCode,
        owner: req.user._id,
        collaborators: [req.user._id],
      });

      const populated = await project.populate('owner', 'username email avatarColor');
      return res.status(201).json(populated);
    } else {
      // In-memory fallback
      const project = {
        _id: `mem_proj_${Date.now()}`,
        name,
        language: selectedLang,
        code: initialCode,
        owner: req.user._id || req.user.id,
        collaborators: [req.user._id || req.user.id],
        roomId: crypto.randomBytes(6).toString('hex'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      inMemoryProjects.push(project);
      return res.status(201).json({
        ...project,
        owner: { _id: req.user._id, username: req.user.username, email: req.user.email, avatarColor: req.user.avatarColor },
        devNote: 'Created in dev fallback mode (MongoDB offline)',
      });
    }
  } catch (error) {
    console.error('[Create Project Error]:', error.message);
    res.status(500).json({ message: 'Server error creating project', error: error.message });
  }
});

/**
 * @route   GET /api/projects
 * @desc    Get all projects the user owns or collaborates on
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
  try {
    if (isDbConnected()) {
      const projects = await Project.find({
        $or: [
          { owner: req.user._id },
          { collaborators: req.user._id },
        ],
      })
        .populate('owner', 'username email avatarColor')
        .populate('collaborators', 'username email avatarColor')
        .populate('lastEditedBy', 'username')
        .sort({ updatedAt: -1 });

      return res.json(projects);
    } else {
      const userId = req.user._id || req.user.id;
      const projects = inMemoryProjects.filter(
        (p) => p.owner === userId || p.collaborators.includes(userId)
      );
      return res.json(projects);
    }
  } catch (error) {
    console.error('[Get Projects Error]:', error.message);
    res.status(500).json({ message: 'Server error fetching projects', error: error.message });
  }
});

/**
 * @route   GET /api/projects/:id
 * @desc    Get a single project by ID
 * @access  Private
 */
router.get('/:id', protect, async (req, res) => {
  try {
    if (isDbConnected()) {
      const project = await Project.findById(req.params.id)
        .populate('owner', 'username email avatarColor')
        .populate('collaborators', 'username email avatarColor')
        .populate('lastEditedBy', 'username');

      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      return res.json(project);
    } else {
      const project = inMemoryProjects.find((p) => p._id === req.params.id);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      return res.json(project);
    }
  } catch (error) {
    console.error('[Get Project Error]:', error.message);
    res.status(500).json({ message: 'Server error fetching project', error: error.message });
  }
});

/**
 * @route   PUT /api/projects/:id
 * @desc    Update project metadata (name, language)
 * @access  Private (owner only)
 */
router.put('/:id', protect, validateProjectInput, async (req, res) => {
  try {
    const { name, language } = req.body;

    if (isDbConnected()) {
      const project = await Project.findById(req.params.id);

      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      if (project.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Only the project owner can update settings' });
      }

      if (name) project.name = name;
      if (language) project.language = language;

      const updated = await project.save();
      const populated = await updated.populate('owner', 'username email avatarColor');
      return res.json(populated);
    } else {
      const project = inMemoryProjects.find((p) => p._id === req.params.id);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      if (name) project.name = name;
      if (language) project.language = language;
      project.updatedAt = new Date().toISOString();
      return res.json(project);
    }
  } catch (error) {
    console.error('[Update Project Error]:', error.message);
    res.status(500).json({ message: 'Server error updating project', error: error.message });
  }
});

/**
 * @route   DELETE /api/projects/:id
 * @desc    Delete a project (owner only)
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    if (isDbConnected()) {
      const project = await Project.findById(req.params.id);

      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      if (project.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Only the project owner can delete this project' });
      }

      await project.deleteOne();
      return res.json({ message: 'Project deleted successfully' });
    } else {
      const idx = inMemoryProjects.findIndex((p) => p._id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ message: 'Project not found' });
      }
      inMemoryProjects.splice(idx, 1);
      return res.json({ message: 'Project deleted successfully' });
    }
  } catch (error) {
    console.error('[Delete Project Error]:', error.message);
    res.status(500).json({ message: 'Server error deleting project', error: error.message });
  }
});

/**
 * @route   POST /api/projects/join/:roomId
 * @desc    Join an existing project by its room ID
 * @access  Private
 */
router.post('/join/:roomId', protect, validateRoomId, async (req, res) => {
  try {
    if (isDbConnected()) {
      const project = await Project.findOne({ roomId: req.params.roomId })
        .populate('owner', 'username email avatarColor')
        .populate('collaborators', 'username email avatarColor');

      if (!project) {
        return res.status(404).json({ message: 'No project found with that room ID' });
      }

      // Add user as collaborator if not already
      const isCollaborator = project.collaborators.some(
        (c) => c._id.toString() === req.user._id.toString()
      );

      if (!isCollaborator) {
        project.collaborators.push(req.user._id);
        await project.save();
        await project.populate('collaborators', 'username email avatarColor');
      }

      return res.json(project);
    } else {
      const project = inMemoryProjects.find((p) => p.roomId === req.params.roomId);
      if (!project) {
        return res.status(404).json({ message: 'No project found with that room ID' });
      }
      // Ensure messages array exists
      if (!project.messages) {
        project.messages = [];
      }
      const userId = req.user._id || req.user.id;
      if (!project.collaborators.includes(userId)) {
        project.collaborators.push(userId);
      }
      return res.json(project);
    }
  } catch (error) {
    console.error('[Join Project Error]:', error.message);
    res.status(500).json({ message: 'Server error joining project', error: error.message });
  }
});

/**
 * Map Monaco/DevCollab language names to Wandbox compiler specs
 */
const WANDBOX_LANG_MAP = {
  c: { compiler: 'gcc-head', options: 'warning,c11' },
  cpp: { compiler: 'gcc-head', options: 'warning,gnu++17' },
  java: { compiler: 'openjdk-jdk-head', options: '' },
  python: { compiler: 'cpython-head', options: '' },
  javascript: { compiler: 'nodejs-head', options: '' },
  typescript: { compiler: 'typescript-5.3.3', options: '' },
  go: { compiler: 'go-head', options: '' },
  rust: { compiler: 'rust-head', options: '' },
  php: { compiler: 'php-head', options: '' },
  ruby: { compiler: 'ruby-head', options: '' },
  csharp: { compiler: 'mono-head', options: '' },
};

/**
 * @route   POST /api/projects/execute
 * @desc    Execute code using Wandbox API sandbox
 * @access  Private
 */
router.post('/execute', protect, async (req, res) => {
  try {
    const { language, code, stdin } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ message: 'Code cannot be empty' });
    }

    const lang = (language || 'javascript').toLowerCase();
    const spec = WANDBOX_LANG_MAP[lang];

    if (!spec) {
      return res.status(400).json({
        message: `Execution not supported for ${language} on server. Try JavaScript or Python (local fallback available).`,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const wbRes = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler: spec.compiler,
        code,
        options: spec.options || '',
        stdin: stdin || '',
        'compiler-option-raw': '',
        'runtime-option-raw': '',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!wbRes.ok) {
      const errText = await wbRes.text();
      return res.status(wbRes.status).json({
        message: 'Execution engine error',
        error: errText,
      });
    }

    const data = await wbRes.json();
    const compileErr = data.compiler_error || data.compiler_message || '';
    const programOut = data.program_output || data.program_message || '';
    const status = Number(data.status);

    if (compileErr && !programOut && status !== 0) {
      return res.json({
        success: false,
        type: 'compile_error',
        stdout: '',
        stderr: compileErr,
        exitCode: status || 1,
      });
    }

    return res.json({
      success: status === 0,
      stdout: programOut,
      stderr: compileErr && status !== 0 ? compileErr : '',
      output: programOut + (compileErr && status === 0 ? '\n' + compileErr : ''),
      exitCode: Number.isFinite(status) ? status : 0,
      language: lang,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ message: 'Code execution timed out (20s limit)' });
    }
    console.error('[Code Execution Error]:', error.message);
    res.status(500).json({ message: 'Server error executing code', error: error.message });
  }
});

module.exports = router;

 