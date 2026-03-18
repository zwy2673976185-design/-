// 松下机器人手册登录系统服务器
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

// 配置信息
const CONFIG = {
  ADMIN_PASSWORD: 'admin123',  // 管理员密码
  SALT_ROUNDS: 10,            // 密码加密强度
  MAX_PENDING_ACCOUNTS: 100   // 最大待审核账户数
};

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
      // 默认管理员账户（用户名：admin，密码：admin123）
      const hashedPassword = await bcrypt.hash(CONFIG.ADMIN_PASSWORD, CONFIG.SALT_ROUNDS);
      const initialWhitelist = {
        users: [
          {
            username: 'admin',
            passwordHash: hashedPassword,
            email: 'admin@example.com',
            status: 'approved', // approved（已批准）, pending（待审核）, rejected（已拒绝）
            role: 'admin',      // admin（管理员）, user（普通用户）
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
      console.log('白名单文件已初始化，默认管理员账号：admin / admin123');
    }
    
    console.log('数据目录初始化完成');
  } catch (error) {
    console.error('初始化数据目录失败:', error);
  }
}

// ================== 用户注册与登录接口 ==================

// 1. 用户注册接口
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      });
    }
    
    // 读取白名单
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    
    // 检查用户名是否已存在
    const existingUser = whitelistData.users.find(u => u.username === username);
    const existingPending = whitelistData.pendingApprovals.find(u => u.username === username);
    
    if (existingUser || existingPending) {
      return res.status(400).json({
        success: false,
        error: '用户名已存在'
      });
    }
    
    // 密码加密
    const passwordHash = await bcrypt.hash(password, CONFIG.SALT_ROUNDS);
    
    // 添加到待审核列表
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
    
    // 保存到文件
    await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelistData, null, 2));
    
    // 在控制台输出注册信息（您需要复制到白名单的信息）
    console.log('\n' + '='.repeat(60));
    console.log('📝 新用户注册申请 - 需要管理员审核');
    console.log('='.repeat(60));
    console.log(`用户名: ${username}`);
    console.log(`邮箱: ${email || '未提供'}`);
    console.log(`注册时间: ${new Date().toISOString()}`);
    console.log(`IP地址: ${req.ip}`);
    console.log('='.repeat(60));
    console.log('💡 管理员操作提示:');
    console.log('1. 将此用户信息复制到 whitelist.json 的 users 数组中');
    console.log('2. 将 status 改为 "approved"');
    console.log('3. 将 approvedBy 设为 "admin"（或其他管理员用户名）');
    console.log('4. 设置 approvedAt 为当前时间');
    console.log('='.repeat(60) + '\n');
    
    res.json({
      success: true,
      message: '注册成功！您的账号已提交审核，请联系管理员批准。',
      username,
      status: 'pending'
    });
    
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({
      success: false,
      error: '注册失败，请稍后重试'
    });
  }
});

// 2. 用户登录接口
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      });
    }
    
    // 读取白名单
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    
    // 查找用户
    const user = whitelistData.users.find(u => u.username === username);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户不存在或未通过审核'
      });
    }
    
    // 检查用户状态
    if (user.status !== 'approved') {
      return res.status(401).json({
        success: false,
        error: '账号未通过审核，请联系管理员'
      });
    }
    
    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: '密码错误'
      });
    }
    
    // 生成登录令牌（简化版，实际应使用JWT）
    const token = {
      username: user.username,
      role: user.role,
      loginTime: new Date().toISOString(),
      expiresIn: 24 * 60 * 60 * 1000 // 24小时
    };
    
    // 更新最后登录时间
    user.lastLogin = new Date().toISOString();
    await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelistData, null, 2));
    
    console.log(`✅ 用户登录: ${username} (${user.role}) - ${new Date().toLocaleString()}`);
    
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
    res.status(500).json({
      success: false,
      error: '登录失败，请稍后重试'
    });
  }
});

// 3. 获取待审核用户列表（管理员用）
app.post('/api/admin/pending-users', async (req, res) => {
  try {
    const { adminPassword } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(403).json({
        success: false,
        error: '管理员密码错误'
      });
    }
    
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    
    res.json({
      success: true,
      pendingUsers: whitelistData.pendingApprovals,
      statistics: whitelistData.statistics
    });
    
  } catch (error) {
    console.error('获取待审核用户失败:', error);
    res.status(500).json({
      success: false,
      error: '获取失败'
    });
  }
});

// 4. 批准用户（管理员用）
app.post('/api/admin/approve-user', async (req, res) => {
  try {
    const { adminPassword, username, approvedBy } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(403).json({
        success: false,
        error: '管理员密码错误'
      });
    }
    
    const whitelistData = JSON.parse(await fs.readFile(WHITELIST_FILE, 'utf8'));
    
    // 查找待审核用户
    const pendingIndex = whitelistData.pendingApprovals.findIndex(u => u.username === username);
    
    if (pendingIndex === -1) {
      return res.status(404).json({
        success: false,
        error: '用户不存在或已被处理'
      });
    }
    
    // 从待审核列表移除
    const [pendingUser] = whitelistData.pendingApprovals.splice(pendingIndex, 1);
    
    // 添加到正式用户列表
    pendingUser.status = 'approved';
    pendingUser.approvedBy = approvedBy || 'admin';
    pendingUser.approvedAt = new Date().toISOString();
    
    whitelistData.users.push(pendingUser);
    
    // 更新统计
    whitelistData.statistics.pendingUsers = whitelistData.pendingApprovals.length;
    whitelistData.statistics.approvedUsers = whitelistData.users.filter(u => u.status === 'approved').length;
    whitelistData.statistics.totalUsers = whitelistData.users.length;
    
    // 保存
    await fs.writeFile(WHITELIST_FILE, JSON.stringify(whitelistData, null, 2));
    
    console.log(`✅ 管理员批准用户: ${username} - 批准人: ${approvedBy}`);
    
    res.json({
      success: true,
      message: '用户批准成功',
      user: {
        username: pendingUser.username,
        email: pendingUser.email
      }
    });
    
  } catch (error) {
    console.error('批准用户失败:', error);
    res.status(500).json({
      success: false,
      error: '批准失败'
    });
  }
});

// ================== 原有手册内容接口 ==================

// 5. 获取手册内容（需要登录验证）
app.get('/api/content', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: '未授权，请先登录'
      });
    }
    
    // 验证令牌（简化）
    const token = authHeader.split(' ')[1];
    try {
      const tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
      
      // 检查令牌是否过期（简化）
      const tokenTime = new Date(tokenData.loginTime).getTime();
      const now = new Date().getTime();
      
      if (now - tokenTime > tokenData.expiresIn) {
        return res.status(401).json({
          success: false,
          error: '登录已过期，请重新登录'
        });
      }
    } catch (e) {
      return res.status(401).json({
        success: false,
        error: '无效的令牌'
      });
    }
    
    // 读取内容
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const content = JSON.parse(data);
    
    res.json({
      success: true,
      data: content,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('读取内容失败:', error);
    res.status(500).json({
      success: false,
      error: '读取内容失败'
    });
  }
});

// 6. 保存手册内容（需要管理员权限）
app.post('/api/content', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: '未授权'
      });
    }
    
    const token = authHeader.split(' ')[1];
    let tokenData;
    
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
      // 这里可以进一步验证用户角色等
    } catch (e) {
      return res.status(401).json({
        success: false,
        error: '无效的令牌'
      });
    }
    
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({
        success: false,
        error: '内容不能为空'
      });
    }
    
    // 添加修改信息
    const enhancedContent = {
      ...content,
      lastModified: new Date().toISOString(),
      modifiedBy: tokenData.username || '未知用户'
    };
    
    // 保存
    await fs.writeFile(DATA_FILE, JSON.stringify(enhancedContent, null, 2), 'utf8');
    
    console.log(`📝 手册内容已更新 - 修改人: ${tokenData.username}`);
    
    res.json({
      success: true,
      message: '内容已成功保存',
      lastModified: enhancedContent.lastModified,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('保存内容失败:', error);
    res.status(500).json({
      success: false,
      error: '保存内容失败'
    });
  }
});

// 7. 服务器状态
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    service: '机器人手册登录系统',
    version: '1.1.0',
    features: ['白名单登录', '待审核机制', '管理员控制'],
    timestamp: new Date().toISOString()
  });
});

// 启动服务器
async function startServer() {
  await initDataDirectory();
  
  app.listen(PORT, () => {
    console.log(`
==========================================
🚀 松下机器人手册登录系统已启动！
📍 本地访问: http://localhost:${PORT}
📡 主要功能:
  - POST /api/register      用户注册（待审核）
  - POST /api/login         用户登录
  - POST /api/admin/*       管理员操作
  - GET  /api/content       获取手册内容（需登录）
⏰ 启动时间: ${new Date().toLocaleString()}
💡 默认管理员: admin / admin123
==========================================
    `);
  });
}

startServer();
