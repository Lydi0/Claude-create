// ==========================================
// 语音记忆助手 - 应用核心逻辑
// ==========================================

// ===========================================
// 1. 配置 & 状态
// ===========================================
const CONFIG = {
  WHISPER_URL: 'https://api.openai.com/v1/audio/transcriptions',
  CLAUDE_URL: 'https://api.anthropic.com/v1/messages',
  CLAUDE_MODEL: 'claude-sonnet-4-5-20250929',
  MAX_TOKENS: 1024,
  VERSION: '1.0.0',
};

const state = {
  currentView: 'voice',
  isRecording: false,
  isProcessing: false,
  isSpeaking: false,
  selectedMemoryId: null,
  activeCategory: 'all',
  searchQuery: '',
};

// ===========================================
// 2. AudioRecorder - 录音模块
// ===========================================
class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.mimeType = '';
  }

  _detectMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/wav',
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioChunks = [];
    this.mimeType = this._detectMimeType();

    const options = this.mimeType ? { mimeType: this.mimeType } : {};
    this.mediaRecorder = new MediaRecorder(this.stream, options);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.start();
  }

  stop() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, {
          type: this.mimeType || 'audio/webm',
        });
        this.stream.getTracks().forEach((track) => track.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }
}

// ===========================================
// 3. MemoryDB - IndexedDB 存储
// ===========================================
class MemoryDB {
  constructor() {
    this.dbName = 'VoiceMemoryDB';
    this.storeName = 'memories';
    this.db = null;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _tx(mode) {
    const tx = this.db.transaction(this.storeName, mode);
    return tx.objectStore(this.storeName);
  }

  async addMemory(memory) {
    const record = {
      id: crypto.randomUUID(),
      content: memory.content,
      category: memory.category || '笔记',
      tags: memory.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: memory.source || 'manual',
    };
    return new Promise((resolve, reject) => {
      const request = this._tx('readwrite').put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllMemories() {
    return new Promise((resolve, reject) => {
      const request = this._tx('readonly').getAll();
      request.onsuccess = () => {
        const results = request.result.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        resolve(results);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getByCategory(category) {
    const all = await this.getAllMemories();
    return all.filter((m) => m.category === category);
  }

  async deleteMemory(id) {
    return new Promise((resolve, reject) => {
      const request = this._tx('readwrite').delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getCount() {
    return new Promise((resolve, reject) => {
      const request = this._tx('readonly').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async searchMemories(query) {
    const all = await this.getAllMemories();
    const lower = query.toLowerCase();
    return all.filter(
      (m) =>
        m.content.toLowerCase().includes(lower) ||
        m.category.toLowerCase().includes(lower) ||
        m.tags.some((t) => t.toLowerCase().includes(lower))
    );
  }

  async exportAll() {
    const memories = await this.getAllMemories();
    return JSON.stringify(memories, null, 2);
  }

  async importAll(jsonString) {
    const memories = JSON.parse(jsonString);
    const store = this._tx('readwrite');
    for (const memory of memories) {
      store.put(memory);
    }
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve(memories.length);
      store.transaction.onerror = (e) => reject(e.target.error);
    });
  }
}

// ===========================================
// 4. VoiceSpeaker - 语音朗读
// ===========================================
class VoiceSpeaker {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.selectedVoiceURI = localStorage.getItem('selectedVoice') || '';
    this._initVoices();
  }

  _initVoices() {
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      if (voices.length === 0) return;

      // 如果用户选择了特定语音
      if (this.selectedVoiceURI) {
        this.voice = voices.find((v) => v.voiceURI === this.selectedVoiceURI);
      }

      // 默认选择中文语音
      if (!this.voice) {
        this.voice =
          voices.find((v) => v.lang === 'zh-CN') ||
          voices.find((v) => v.lang.startsWith('zh')) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];
      }

      // 填充设置页的语音选择列表
      this._populateVoiceSelect(voices);
    };

    loadVoices();
    this.synth.addEventListener('voiceschanged', loadVoices);
    // Safari 可能不触发 voiceschanged，轮询
    setTimeout(loadVoices, 300);
    setTimeout(loadVoices, 1000);
  }

  _populateVoiceSelect(voices) {
    const select = document.getElementById('voice-select');
    if (!select || select.options.length > 1) return;

    const zhVoices = voices.filter((v) => v.lang.startsWith('zh'));
    const otherVoices = voices.filter((v) => !v.lang.startsWith('zh'));

    if (zhVoices.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '中文';
      zhVoices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = v.name;
        if (v.voiceURI === this.selectedVoiceURI) opt.selected = true;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }

    if (otherVoices.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '其他';
      otherVoices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.voiceURI === this.selectedVoiceURI) opt.selected = true;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }
  }

  setVoice(voiceURI) {
    this.selectedVoiceURI = voiceURI;
    localStorage.setItem('selectedVoice', voiceURI);
    const voices = this.synth.getVoices();
    this.voice = voices.find((v) => v.voiceURI === voiceURI) || this.voice;
  }

  speak(text) {
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = 'zh-CN';

    return new Promise((resolve, reject) => {
      utterance.onend = resolve;
      utterance.onerror = (e) => {
        if (e.error === 'canceled') resolve();
        else reject(e);
      };
      this.synth.speak(utterance);
    });
  }

  stop() {
    this.synth.cancel();
  }
}

// ===========================================
// 5. API 客户端
// ===========================================
class APIClient {
  getOpenAIKey() {
    return localStorage.getItem('openai_api_key') || '';
  }

  getAnthropicKey() {
    return localStorage.getItem('anthropic_api_key') || '';
  }

  async transcribe(audioBlob, mimeType) {
    const key = this.getOpenAIKey();
    if (!key) {
      throw new Error('请先在设置页面配置 OpenAI API Key');
    }

    const ext = mimeType.includes('mp4') || mimeType.includes('aac')
      ? 'm4a'
      : mimeType.includes('webm')
        ? 'webm'
        : 'wav';

    const formData = new FormData();
    formData.append('file', audioBlob, `recording.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'zh');

    const response = await fetch(CONFIG.WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `语音转录失败 (${response.status})`);
    }

    const data = await response.json();
    return data.text;
  }

  async queryClaude(systemPrompt, userMessage) {
    const key = this.getAnthropicKey();
    if (!key) {
      throw new Error('请先在设置页面配置 Anthropic API Key');
    }

    const response = await fetch(CONFIG.CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: CONFIG.MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Claude 请求失败 (${response.status})`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '没有收到回复';
  }
}

// ===========================================
// 6. UI 控制器
// ===========================================
const UI = {
  // 视图切换
  switchView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));

    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelector(`.tab[data-view="${viewName}"]`).classList.add('active');

    state.currentView = viewName;

    if (viewName === 'memories') {
      App.refreshMemoryList();
    }
    if (viewName === 'settings') {
      App.refreshSettings();
    }
  },

  // 麦克风按钮状态
  setMicState(micState) {
    const btn = document.getElementById('mic-btn');
    btn.classList.remove('recording', 'processing');
    if (micState === 'recording') {
      btn.classList.add('recording');
    } else if (micState === 'processing') {
      btn.classList.add('processing');
    }
  },

  // 语音状态文字
  setStatus(text, className) {
    const el = document.getElementById('voice-status');
    el.textContent = text;
    el.className = 'voice-status';
    if (className) el.classList.add(className);
  },

  // 对话气泡
  addBubble(type, content) {
    const container = document.getElementById('conversation');
    // 清除占位符
    const placeholder = container.querySelector('.conversation-placeholder');
    if (placeholder) placeholder.remove();

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;

    if (type === 'assistant' && content !== '...') {
      bubble.textContent = content;
      // 添加"保存为记忆"链接
      const saveLink = document.createElement('span');
      saveLink.className = 'save-memory-link';
      saveLink.textContent = '保存为记忆';
      saveLink.onclick = () => App.saveResponseAsMemory(content);
      bubble.appendChild(saveLink);
    } else if (content === '...') {
      // 加载动画
      const indicator = document.createElement('div');
      indicator.className = 'typing-indicator';
      indicator.innerHTML = '<span></span><span></span><span></span>';
      bubble.appendChild(indicator);
      bubble.dataset.loading = 'true';
    } else {
      bubble.textContent = content;
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  },

  // 替换加载气泡
  replaceLoadingBubble(content) {
    const container = document.getElementById('conversation');
    const loadingBubble = container.querySelector('[data-loading="true"]');
    if (loadingBubble) {
      loadingBubble.remove();
    }
    return this.addBubble('assistant', content);
  },

  addSystemBubble(content) {
    return this.addBubble('system', content);
  },

  // Toast 通知
  showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  },

  // 记忆列表渲染
  renderMemoryList(memories) {
    const list = document.getElementById('memory-list');

    if (memories.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <p>还没有记忆</p>
          <p class="hint">去语音页面说点什么吧</p>
        </div>
      `;
      return;
    }

    list.innerHTML = memories
      .map(
        (m) => `
      <div class="memory-card" data-id="${m.id}">
        <div class="memory-card-header">
          <span class="category-badge">${m.category}</span>
          <span class="memory-date">${formatDate(m.createdAt)}</span>
        </div>
        <div class="memory-preview">${escapeHtml(m.content)}</div>
      </div>
    `
      )
      .join('');

    // 绑定点击事件
    list.querySelectorAll('.memory-card').forEach((card) => {
      card.addEventListener('click', () => {
        const memory = memories.find((m) => m.id === card.dataset.id);
        if (memory) App.showMemoryDetail(memory);
      });
    });
  },

  // 显示/隐藏弹窗
  showModal(id) {
    document.getElementById(id).classList.remove('hidden');
  },

  hideModal(id) {
    document.getElementById(id).classList.add('hidden');
  },
};

// ===========================================
// 7. App 协调器
// ===========================================
const App = {
  recorder: new AudioRecorder(),
  db: new MemoryDB(),
  speaker: new VoiceSpeaker(),
  api: new APIClient(),

  async init() {
    // 打开数据库
    await this.db.open();

    // 请求持久存储
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // 绑定事件
    this.bindEvents();

    // 加载主题
    this.loadTheme();

    // 加载 API Key 到表单
    this.loadKeys();

    // 检查 iOS 安装提示
    this.checkInstallPrompt();

    // 后台切换时停止朗读
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.isSpeaking) {
        this.speaker.stop();
        state.isSpeaking = false;
        UI.setStatus('点击麦克风开始对话');
      }
    });
  },

  bindEvents() {
    // Tab 切换
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => UI.switchView(tab.dataset.view));
    });

    // 麦克风按钮
    document.getElementById('mic-btn').addEventListener('click', () => this.handleMicButton());

    // 搜索
    document.getElementById('search-input').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      this.refreshMemoryList();
    });

    // 类别筛选
    document.querySelectorAll('.cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeCategory = tab.dataset.category;
        this.refreshMemoryList();
      });
    });

    // 添加记忆按钮
    document.getElementById('add-memory-btn').addEventListener('click', () => {
      UI.showModal('add-memory-modal');
    });

    // 添加记忆弹窗
    document.getElementById('cancel-add-memory').addEventListener('click', () => {
      UI.hideModal('add-memory-modal');
    });
    document.getElementById('confirm-add-memory').addEventListener('click', () => this.addManualMemory());

    // 记忆详情弹窗
    document.getElementById('close-detail-btn').addEventListener('click', () => {
      UI.hideModal('memory-detail-modal');
    });
    document.getElementById('delete-memory-btn').addEventListener('click', () => this.deleteCurrentMemory());

    // 设置 - 保存密钥
    document.getElementById('save-keys-btn').addEventListener('click', () => this.saveKeys());

    // 设置 - 显示/隐藏密钥
    document.querySelectorAll('.toggle-key-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // 设置 - 语音选择
    document.getElementById('voice-select').addEventListener('change', (e) => {
      this.speaker.setVoice(e.target.value);
    });

    // 设置 - 自动朗读
    document.getElementById('auto-speak').addEventListener('change', (e) => {
      localStorage.setItem('autoSpeak', e.target.checked);
    });

    // 设置 - 主题
    document.getElementById('theme-select').addEventListener('change', (e) => {
      this.setTheme(e.target.value);
    });

    // 设置 - 导出
    document.getElementById('export-btn').addEventListener('click', () => this.exportMemories());

    // 设置 - 导入
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => this.importMemories(e));

    // 安装引导
    document.getElementById('dismiss-install').addEventListener('click', () => {
      UI.hideModal('install-prompt');
      localStorage.setItem('installDismissed', 'true');
    });
  },

  // -------- 麦克风核心流程 --------
  async handleMicButton() {
    if (state.isProcessing) return;

    if (state.isSpeaking) {
      this.speaker.stop();
      state.isSpeaking = false;
      UI.setStatus('点击麦克风开始对话');
      return;
    }

    if (state.isRecording) {
      // 停止录音
      state.isRecording = false;
      UI.setMicState('processing');
      state.isProcessing = true;

      try {
        UI.setStatus('正在停止录音...', 'processing');
        const audioBlob = await this.recorder.stop();

        // Step 1: 转录
        UI.setStatus('正在转录语音...', 'processing');
        const transcript = await this.api.transcribe(audioBlob, this.recorder.mimeType);

        if (!transcript || transcript.trim() === '') {
          UI.setStatus('未检测到语音，请重试');
          UI.setMicState('ready');
          state.isProcessing = false;
          return;
        }

        // 显示用户语音
        UI.addBubble('user', transcript);

        // Step 2: 判断意图
        const intent = this.detectIntent(transcript);

        // Step 3: 获取所有记忆
        const memories = await this.db.getAllMemories();

        if (intent === 'store') {
          // 存储模式
          UI.setStatus('正在整理记忆...', 'processing');
          const loadingBubble = UI.addBubble('assistant', '...');

          const systemPrompt = this.buildStorePrompt();
          const response = await this.api.queryClaude(systemPrompt, transcript);

          // 解析 Claude 的回复
          const parsed = this.parseStoreResponse(response, transcript);
          await this.db.addMemory({
            content: parsed.content,
            category: parsed.category,
            tags: parsed.tags,
            source: 'voice',
          });

          UI.replaceLoadingBubble(`已保存到"${parsed.category}"：${parsed.content}`);
          UI.setStatus('记忆已保存');

          if (this.shouldAutoSpeak()) {
            state.isSpeaking = true;
            await this.speaker.speak(`已保存。${parsed.content}`);
            state.isSpeaking = false;
          }
        } else {
          // 检索模式
          UI.setStatus('正在思考...', 'processing');
          const loadingBubble = UI.addBubble('assistant', '...');

          const systemPrompt = this.buildRetrievePrompt(memories);
          const response = await this.api.queryClaude(systemPrompt, transcript);

          UI.replaceLoadingBubble(response);
          UI.setStatus('回复完成');

          if (this.shouldAutoSpeak()) {
            state.isSpeaking = true;
            UI.setStatus('正在朗读...', 'processing');
            await this.speaker.speak(response);
            state.isSpeaking = false;
          }
        }

        UI.setStatus('点击麦克风开始对话');
      } catch (error) {
        UI.addBubble('system', error.message);
        UI.setStatus('出错了，请重试');
      }

      UI.setMicState('ready');
      state.isProcessing = false;
    } else {
      // 开始录音
      try {
        await this.recorder.start();
        state.isRecording = true;
        UI.setMicState('recording');
        UI.setStatus('正在聆听...', 'listening');
      } catch (error) {
        UI.showToast('无法访问麦克风，请允许麦克风权限');
      }
    }
  },

  // -------- 意图识别 --------
  detectIntent(text) {
    const storePatterns = [
      /^(记住|记下|保存|存储|存下|备忘|备注|记录|添加|加上|存一下|帮我记|帮忙记|存个)/,
      /^(remember|save|store|note|add|record)\b/i,
    ];
    for (const pattern of storePatterns) {
      if (pattern.test(text.trim())) return 'store';
    }
    return 'retrieve';
  },

  // -------- Claude Prompt 构建 --------
  buildStorePrompt() {
    return `你是一个个人记忆整理助手。用户通过语音输入了一条想要存储的记忆。

你的任务：
1. 整理和清理用户说的内容，使其更清晰易读（但保留原意）
2. 为这条记忆选择一个最合适的类别
3. 提取相关的标签关键词

可选类别：对话、工作、思考、哲思、笔记

请严格按以下格式回复（不要添加其他内容）：
[CATEGORY]类别名称[/CATEGORY]
[TAGS]标签1,标签2,标签3[/TAGS]
[CONTENT]整理后的记忆内容[/CONTENT]`;
  },

  buildRetrievePrompt(memories) {
    let memoriesContext = '（暂无存储的记忆）';

    if (memories.length > 0) {
      memoriesContext = memories
        .map(
          (m, i) =>
            `【记忆 ${i + 1}】[${m.category}] (${formatDate(m.createdAt)})\n${m.content}`
        )
        .join('\n\n---\n\n');
    }

    return `你是一个私人记忆检索助手。用户通过语音向你提问，你需要从他们存储的记忆中找到相关内容并回答。

规则：
- 用中文回复
- 只引用与问题相关的记忆
- 如果没有找到相关记忆，坦诚告知
- 引用记忆时说明是哪条记忆的内容
- 回复简洁但完整
- 如果用户只是在闲聊或打招呼，友好地回应，并提醒他们可以存储或检索记忆
- 如果用户的问题需要你创造性回答（不只是检索），你可以结合记忆进行思考和回答

以下是用户存储的所有记忆：

${memoriesContext}`;
  },

  // -------- 解析存储回复 --------
  parseStoreResponse(response, originalText) {
    const categoryMatch = response.match(/\[CATEGORY\](.*?)\[\/CATEGORY\]/);
    const tagsMatch = response.match(/\[TAGS\](.*?)\[\/TAGS\]/);
    const contentMatch = response.match(/\[CONTENT\](.*?)\[\/CONTENT\]/s);

    const validCategories = ['对话', '工作', '思考', '哲思', '笔记'];
    let category = categoryMatch ? categoryMatch[1].trim() : '笔记';
    if (!validCategories.includes(category)) category = '笔记';

    const tags = tagsMatch
      ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const content = contentMatch ? contentMatch[1].trim() : originalText;

    return { category, tags, content };
  },

  // -------- 保存回复为记忆 --------
  async saveResponseAsMemory(content) {
    await this.db.addMemory({
      content,
      category: '笔记',
      tags: [],
      source: 'voice',
    });
    UI.showToast('已保存为记忆');
  },

  // -------- 手动添加记忆 --------
  async addManualMemory() {
    const textEl = document.getElementById('new-memory-text');
    const categoryEl = document.getElementById('new-memory-category');
    const text = textEl.value.trim();

    if (!text) {
      UI.showToast('请输入记忆内容');
      return;
    }

    await this.db.addMemory({
      content: text,
      category: categoryEl.value,
      tags: [],
      source: 'manual',
    });

    textEl.value = '';
    UI.hideModal('add-memory-modal');
    UI.showToast('记忆已保存');
    this.refreshMemoryList();
  },

  // -------- 记忆列表刷新 --------
  async refreshMemoryList() {
    let memories;

    if (state.searchQuery) {
      memories = await this.db.searchMemories(state.searchQuery);
    } else if (state.activeCategory !== 'all') {
      memories = await this.db.getByCategory(state.activeCategory);
    } else {
      memories = await this.db.getAllMemories();
    }

    UI.renderMemoryList(memories);
  },

  // -------- 记忆详情 --------
  showMemoryDetail(memory) {
    state.selectedMemoryId = memory.id;
    document.getElementById('detail-category').textContent = memory.category;
    document.getElementById('detail-date').textContent = formatDate(memory.createdAt);
    document.getElementById('detail-content').textContent = memory.content;
    UI.showModal('memory-detail-modal');
  },

  async deleteCurrentMemory() {
    if (!state.selectedMemoryId) return;
    await this.db.deleteMemory(state.selectedMemoryId);
    state.selectedMemoryId = null;
    UI.hideModal('memory-detail-modal');
    UI.showToast('记忆已删除');
    this.refreshMemoryList();
  },

  // -------- 设置相关 --------
  loadKeys() {
    document.getElementById('openai-key').value = localStorage.getItem('openai_api_key') || '';
    document.getElementById('anthropic-key').value = localStorage.getItem('anthropic_api_key') || '';
    document.getElementById('auto-speak').checked = this.shouldAutoSpeak();
  },

  saveKeys() {
    const openaiKey = document.getElementById('openai-key').value.trim();
    const anthropicKey = document.getElementById('anthropic-key').value.trim();

    if (openaiKey) localStorage.setItem('openai_api_key', openaiKey);
    else localStorage.removeItem('openai_api_key');

    if (anthropicKey) localStorage.setItem('anthropic_api_key', anthropicKey);
    else localStorage.removeItem('anthropic_api_key');

    UI.showToast('密钥已保存');
  },

  async refreshSettings() {
    const count = await this.db.getCount();
    document.getElementById('memory-count').textContent = `已存储 ${count} 条记忆`;

    // 存储空间信息
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const usageMB = (usage / 1024 / 1024).toFixed(1);
      const quotaMB = (quota / 1024 / 1024).toFixed(0);
      document.getElementById('storage-info').textContent = `已使用 ${usageMB}MB / ${quotaMB}MB`;
    }

    // 主题
    document.getElementById('theme-select').value = localStorage.getItem('theme') || 'auto';
  },

  shouldAutoSpeak() {
    const saved = localStorage.getItem('autoSpeak');
    return saved === null ? true : saved === 'true';
  },

  // -------- 主题 --------
  loadTheme() {
    const theme = localStorage.getItem('theme') || 'auto';
    this.setTheme(theme);
  },

  setTheme(theme) {
    localStorage.setItem('theme', theme);
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  },

  // -------- 导出/导入 --------
  async exportMemories() {
    try {
      const json = await this.db.exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memories-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      UI.showToast('导出成功');
    } catch (error) {
      UI.showToast('导出失败: ' + error.message);
    }
  },

  async importMemories(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const count = await this.db.importAll(text);
      UI.showToast(`成功导入 ${count} 条记忆`);
      this.refreshMemoryList();
      this.refreshSettings();
    } catch (error) {
      UI.showToast('导入失败: ' + error.message);
    }

    // 重置文件输入
    event.target.value = '';
  },

  // -------- iOS 安装提示 --------
  checkInstallPrompt() {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    const isDismissed = localStorage.getItem('installDismissed') === 'true';
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (!isStandalone && isIOS && !isDismissed) {
      // 延迟显示，让用户先看到 app
      setTimeout(() => UI.showModal('install-prompt'), 2000);
    }
  },
};

// ===========================================
// 8. 工具函数
// ===========================================
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (year === now.getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${year}年${month}月${day}日`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===========================================
// 9. 启动
// ===========================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
