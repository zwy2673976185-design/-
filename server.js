const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置路径
const DATA_DIR = path.join(__dirname, 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'manual_data.json');
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');
const SESSIONS_DIR = path.join(__dirname, 'sessions');

// 配置
const CONFIG = {
  ADMIN_PASSWORD: 'admin123',
  SESSION_TIMEOUT: 7 * 24 * 60 * 60 * 1000, // 7天
  HEARTBEAT_INTERVAL: 5 * 60 * 1000, // 5分钟心跳
};

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 初始化
async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  
  // 初始化数据文件
  try { await fs.access(DATA_FILE); } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({
      title: '松下 TM-1800 机器人编程手册',
      subtitle: '型号：YA-2JMR81F00 | 负载：6kg | 臂展：1809.5mm | 6轴',
      content: '这里是手册内容...',
      lastModified: new Date().toISOString(),
    }, null, 2));
  }
  
  // 初始化白名单
  try { await fs.access(WHITELIST_FILE); } catch {
    const hashedPassword = crypto.createHash('sha256').update(CONFIG.ADMIN_PASSWORD).digest('hex');
    await fs.writeFile(WHITELIST_FILE, JSON.stringify({
      users: [{
        username: 'admin',
        passwordHash: hashedPassword,
        email: '',
        role: 'admin',
        status: 'approved',
        createdAt: new Date().toISOString(),
      }],
    }, null, 2));
  }
  
  console.log('✅ 系统初始化完成');
}

// 工具函数
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function getUser(username) {
  const whitelist = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
  return whitelist.users.find(u => u.username === username);
}

async function saveUser(user) {
  const whitelist = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
  const index = whitelist.users.findIndex(u => u.username === user.username);
  if (index >= 0) whitelist.users[index] = user;
  else whitelist.users.push(user);
  await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelist, null, 2));
}

async function deleteUser(username) {
  const whitelist = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
  whitelist.users = whitelist.users.filter(u => u.username !== username);
  await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelist, null, 2));
  
  // 删除会话文件
  try {
    await fs.unlink(path.join(SESSIONS_DIR, `${username}.json`));
  } catch {}
}

async function getSession(username) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${username}.json`);
    const data = await fs.readFile(sessionFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveSession(username, session) {
  const sessionFile = path.join(SESSIONS_DIR, `${username}.json`);
  await fs.writeFile(sessionFile, JSON.stringify(session, null, 2));
}

async function deleteSession(username) {
  try {
    await fs.unlink(path.join(SESSIONS_DIR, `${username}.json`));
  } catch {}
}

// 生成设备令牌
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证会话
async function verifySession(username, deviceToken) {
  const session = await getSession(username);
  if (!session) return false;
  
  // 检查会话是否过期
  if (Date.now() - session.lastActive > CONFIG.SESSION_TIMEOUT) {
    await deleteSession(username);
    return false;
  }
  
  // 检查设备令牌是否匹配
  if (session.deviceToken !== deviceToken) {
    return false;
  }
  
  // 更新最后活动时间
  session.lastActive = Date.now();
  await saveSession(username, session);
  
  return true;
}

// API接口
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, deviceId } = req.body;
    
    if (!username || !password || !deviceId) {
      return res.json({ success: false, error: '缺少参数' });
    }
    
    // 检查用户是否存在
    const user = await getUser(username);
    if (!user || user.status !== 'approved') {
      return res.json({ success: false, error: '用户不存在或未批准' });
    }
    
    // 验证密码
    if (user.passwordHash !== hashPassword(password)) {
      return res.json({ success: false, error: '密码错误' });
    }
    
    // 检查是否已在其他设备登录
    const existingSession = await getSession(username);
    if (existingSession) {
      // 如果已经在其他设备登录，拒绝新登录
      return res.json({ 
        success: false, 
        error: '账号已在其他设备登录',
        code: 'ALREADY_LOGGED_IN'
      });
    }
    
    // 创建新会话
    const deviceToken = generateDeviceToken();
    const session = {
      username,
      deviceToken,
      deviceId,
      loginTime: Date.now(),
      lastActive: Date.now(),
      ip: req.ip,
    };
    
    await saveSession(username, session);
    
    res.json({
      success: true,
      message: '登录成功',
      token: deviceToken,
      user: {
        username: user.username,
        role: user.role,
        email: user.email,
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    res.json({ success: false, error: '登录失败' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const { username, token } = req.body;
    
    if (!username || !token) {
      return res.json({ success: false, error: '缺少参数' });
    }
    
    // 验证令牌
    const valid = await verifySession(username, token);
    if (!valid) {
      return res.json({ success: false, error: '无效的会话' });
    }
    
    // 删除会话
    await deleteSession(username);
    
    res.json({ success: true, message: '已退出登录' });
    
  } catch (error) {
    res.json({ success: false, error: '退出失败' });
  }
});

app.post('/api/check-session', async (req, res) => {
  try {
    const { username, token } = req.body;
    
    if (!username || !token) {
      return res.json({ success: false, valid: false });
    }
    
    // 检查用户是否在白名单
    const user = await getUser(username);
    if (!user || user.status !== 'approved') {
      await deleteSession(username);
      return res.json({ 
        success: false, 
        valid: false, 
        error: '用户不在白名单中' 
      });
    }
    
    // 验证会话
    const valid = await verifySession(username, token);
    
    if (valid) {
      res.json({ 
        success: true, 
        valid: true,
        user: {
          username: user.username,
          role: user.role,
          email: user.email,
        }
      });
    } else {
      res.json({ success: true, valid: false });
    }
    
  } catch (error) {
    res.json({ success: false, valid: false });
  }
});

app.get('/api/content', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    res.json({ success: true, data });
  } catch (error) {
    res.json({ success: false, error: '获取内容失败' });
  }
});

app.post('/api/content', async (req, res) => {
  try {
    const { username, token, content } = req.body;
    
    if (!username || !token) {
      return res.json({ success: false, error: '未授权' });
    }
    
    // 验证会话
    const valid = await verifySession(username, token);
    if (!valid) {
      return res.json({ success: false, error: '会话无效或已过期' });
    }
    
    // 检查用户权限
    const user = await getUser(username);
    if (user.role !== 'admin') {
      return res.json({ success: false, error: '无权限' });
    }
    
    // 保存内容
    const newData = {
      ...content,
      lastModified: new Date().toISOString(),
      modifiedBy: username,
    };
    
    await fs.writeFile(DATA_FILE, JSON.stringify(newData, null, 2));
    
    res.json({ 
      success: true, 
      message: '内容已保存',
      lastModified: newData.lastModified,
    });
    
  } catch (error) {
    res.json({ success: false, error: '保存失败' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, error: '用户名和密码不能为空' });
    }
    
    // 检查是否已存在
    const existing = await getUser(username);
    if (existing) {
      return res.json({ success: false, error: '用户名已存在' });
    }
    
    // 创建用户（待审核状态）
    const newUser = {
      username,
      passwordHash: hashPassword(password),
      email: email || '',
      role: 'user',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    
    await saveUser(newUser);
    
    console.log(`📝 新用户注册: ${username} (${email || '无邮箱'})`);
    
    res.json({ 
      success: true, 
      message: '注册成功，请等待管理员审核',
      username,
    });
    
  } catch (error) {
    res.json({ success: false, error: '注册失败' });
  }
});

// 管理员接口
app.post('/api/admin/users', async (req, res) => {
  try {
    const { adminPassword } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.json({ success: false, error: '管理员密码错误' });
    }
    
    const whitelist = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    
    res.json({ 
      success: true, 
      users: whitelist.users,
    });
    
  } catch (error) {
    res.json({ success: false, error: '获取用户列表失败' });
  }
});

app.post('/api/admin/approve', async (req, res) => {
  try {
    const { adminPassword, username } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.json({ success: false, error: '管理员密码错误' });
    }
    
    const user = await getUser(username);
    if (!user) {
      return res.json({ success: false, error: '用户不存在' });
    }
    
    user.status = 'approved';
    await saveUser(user);
    
    res.json({ 
      success: true, 
      message: '用户已批准',
      user: {
        username: user.username,
        email: user.email,
      }
    });
    
  } catch (error) {
    res.json({ success: false, error: '批准失败' });
  }
});

app.post('/api/admin/delete', async (req, res) => {
  try {
    const { adminPassword, username } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.json({ success: false, error: '管理员密码错误' });
    }
    
    await deleteUser(username);
    
    res.json({ 
      success: true, 
      message: '用户已删除',
    });
    
  } catch (error) {
    res.json({ success: false, error: '删除失败' });
  }
});

// 心跳接口
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { username, token } = req.body;
    
    if (!username || !token) {
      return res.json({ success: false });
    }
    
    // 验证会话
    const valid = await verifySession(username, token);
    
    if (valid) {
      res.json({ success: true, valid: true });
    } else {
      res.json({ success: true, valid: false });
    }
    
  } catch (error) {
    res.json({ success: false });
  }
});

// 服务器状态
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    service: '多端互斥登录系统',
    timestamp: new Date().toISOString(),
  });
});

// 启动服务器
async function startServer() {
  await init();
  
  app.listen(PORT, () => {
    console.log(`
🚀 多端互斥登录系统已启动
📍 地址: http://localhost:${PORT}
⏰ 时间: ${new Date().toLocaleString()}
📡 功能:
  - 单设备登录限制
  - 白名单控制
  - 会话持久化
  - 实时状态检查
    `);
  });
}

startServer();
