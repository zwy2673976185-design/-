const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置文件路径
const DATA_DIR = path.join(__dirname, 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'manual_data.json');
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');

// 配置信息 - 请修改密码！
const CONFIG = {
  ADMIN_PASSWORD: 'admin123', // 您自己用的管理员密码，请务必修改！
  SALT_ROUNDS: 10
};

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 静态文件目录

// 初始化数据目录
async function initDataDirectory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // 初始化手册数据文件
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify({
        title: '松下 TM-1800 机器人编程手册',
        subtitle: '型号：YA-2JMR81F00 | 负载：6kg | 臂展：1809.5mm | 6轴',
        sections: {},
        videos: [],
        lastModified: new Date().toISOString(),
        modifiedBy: '系统初始化'
      }, null, 2));
    }
    
    // 初始化白名单文件
    try {
      await fs.access(WHITELIST_FILE);
    } catch {
      const hashedPassword = await bcrypt.hash(CONFIG.ADMIN_PASSWORD, CONFIG.SALT_ROUNDS);
      const initialWhitelist = {
        users: [
          {
            username: 'admin',
            passwordHash: hashedPassword,
            email: '',
            status: 'approved',
            role: 'admin',
            createdAt: new Date().toISOString(),
            approvedBy: 'system',
            approvedAt: new Date().toISOString()
          }
        ],
        pendingApprovals: [],
        statistics: {
          totalUsers: 1,
          approvedUsers: 1,
          pendingUsers: 0
        }
      };
      await fs.writeFile(WHITELIST_FILE, JSON.stringify(initialWhitelist, null, 2));
    }
    
    console.log('✅ 数据目录初始化完成');
  } catch (error) {
    console.error('❌ 初始化失败:', error);
  }
}

// ================== API 接口 ==================

// 1. 用户注册
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }
    
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    const existingUser = whitelistData.users.find(u => u.username === username);
    const existingPending = whitelistData.pendingApprovals.find(u => u.username === username);
    
    if (existingUser || existingPending) {
      return res.status(400).json({ success: false, error: '用户名已存在' });
    }
    
    const passwordHash = await bcrypt.hash(password, CONFIG.SALT_ROUNDS);
    const newPendingUser = {
      username,
      passwordHash,
      email: email || '',
      status: 'pending',
      role: 'user',
      createdAt: new Date().toISOString(),
      registerInfo: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString()
      }
    };
    
    whitelistData.pendingApprovals.push(newPendingUser);
    whitelistData.statistics.pendingUsers = whitelistData.pendingApprovals.length;
    await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelistData, null, 2));
    
    // 在控制台打印注册信息（方便您复制到白名单）
    console.log('\n' + '='.repeat(60));
    console.log('📝 新用户注册申请:');
    console.log(`用户名: ${username}`);
    console.log(`邮箱: ${email || '无'}`);
    console.log(`时间: ${new Date().toLocaleString()}`);
    console.log(`IP: ${req.ip}`);
    console.log('='.repeat(60));
    console.log('💡 请将以上信息添加到 whitelist.json 的 users 数组中');
    console.log('='.repeat(60) + '\n');
    
    res.json({
      success: true,
      message: '注册成功！请等待管理员审核。',
      username,
      status: 'pending'
    });
    
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ success: false, error: '注册失败' });
  }
});

// 2. 用户登录
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }
    
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    const user = whitelistData.users.find(u => u.username === username);
    
    if (!user) {
      return res.status(401).json({ success: false, error: '用户不存在或未通过审核' });
    }
    
    if (user.status !== 'approved') {
      return res.status(401).json({ success: false, error: '账号未通过审核，请联系管理员' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: '密码错误' });
    }
    
    // 生成登录令牌（简化版）
    const token = {
      username: user.username,
      role: user.role,
      loginTime: new Date().toISOString(),
      expiresIn: 24 * 60 * 60 * 1000 // 24小时
    };
    
    user.lastLogin = new Date().toISOString();
    await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelistData, null, 2));
    
    console.log(`✅ 用户登录: ${username} (${user.role})`);
    
    res.json({
      success: true,
      message: '登录成功',
      token: Buffer.from(JSON.stringify(token)).toString('base64'),
      user: {
        username: user.username,
        role: user.role,
        email: user.email
      }
    });
    
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ success: false, error: '登录失败' });
  }
});

// 3. 获取手册内容（需要登录）
app.get('/api/content', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '未授权，请先登录' });
    }
    
    // 简化验证（实际应用应更严格）
    const data = await fs.readFile(DATA_FILE, 'utf8');
    res.json({
      success: true,
      data: JSON.parse(data),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('读取内容失败:', error);
    res.status(500).json({ success: false, error: '读取内容失败' });
  }
});

// 4. 保存手册内容（需要管理员权限）
app.post('/api/content', async (req, res) => {
  try {
    const { password, content } = req.body;
    
    if (password !== CONFIG.ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: '管理员密码错误' });
    }
    
    if (!content) {
      return res.status(400).json({ success: false, error: '内容不能为空' });
    }
    
    const enhancedContent = {
      ...content,
      lastModified: new Date().toISOString(),
      modifiedBy: '管理员'
    };
    
    await fs.writeFile(DATA_FILE, JSON.stringify(enhancedContent, null, 2), 'utf8');
    console.log(`📝 手册内容已更新`);
    
    res.json({
      success: true,
      message: '内容已成功保存到服务器',
      lastModified: enhancedContent.lastModified
    });
    
  } catch (error) {
    console.error('保存失败:', error);
    res.status(500).json({ success: false, error: '保存失败' });
  }
});

// 5. 主页面路由（提供前端）
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>松下机器人手册</title>
      <meta http-equiv="refresh" content="0; url=/enhanced_manual.html">
    </head>
    <body>
      <p>正在跳转到手册页面...</p>
    </body>
    </html>
  `);
});

// 启动服务器
async function startServer() {
  await initDataDirectory();
  
  app.listen(PORT, () => {
    console.log(`
🚀 服务器已启动！
📍 地址: http://localhost:${PORT}
📡 主要API:
  - POST /api/register   用户注册
  - POST /api/login      用户登录
  - GET  /api/content    获取内容
  - POST /api/content    保存内容
⏰ 时间: ${new Date().toLocaleString()}
💡 默认管理员账号: admin / admin123
    `);
  });
}

startServer();
