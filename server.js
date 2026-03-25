require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const app  = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// 提供 public 目录下的静态文件
app.use(express.static(path.join(__dirname, 'public')));

// S3 客户端配置
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// 创建数据库连接池
const pool = mysql.createPool({
  host:            process.env.DB_HOST,
  port:            parseInt(process.env.DB_PORT) || 3306,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

// 登录接口
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: '用户名或密码不能为空！' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, real_name FROM person WHERE username = ? AND password = ? AND status = 1',
      [username, password]
    );

    if (rows.length > 0) {
      res.json({ 
        success: true, 
        message: '登录成功', 
        user: { 
          id: rows[0].id, 
          name: rows[0].real_name,
          username: rows[0].username
        } 
      });
    } else {
      res.json({ success: false, message: '用户名或密码不匹配，请重新输入！' });
    }
  } catch (err) {
    console.error('数据库查询错误：', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请联系管理员。' });
  }
});

// 获取当前登录用户信息
app.get('/api/user', async (req, res) => {
  const username = req.headers['x-username'];
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT p.id, p.username, p.real_name, p.dept_id, d.name as dept_name FROM person p LEFT JOIN department d ON p.dept_id = d.id WHERE p.username = ? AND p.status = 1',
      [username]
    );
    if (rows.length > 0) {
      res.json({ success: true, user: rows[0] });
    } else {
      res.status(401).json({ success: false, message: '用户不存在' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 文件类型映射
const FILE_TYPE_MAP = {
  'Word': ['doc', 'docx'],
  'Excel': ['xls', 'xlsx', 'csv'],
  'PPT': ['ppt', 'pptx'],
  'PDF': ['pdf'],
  '图片': ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'tif', 'tiff', 'webp', 'psd', 'ai', 'svg'],
  '3D模型': ['obj', 'fbx', 'stl', '3ds', 'c4d', 'glb', 'blend'],
  '视频': ['mp4', 'avi', 'wmv', 'mov', 'flv', 'webm', 'm4v', 'mkv'],
  '音频': ['mp3', 'wav', 'aac', 'm4a', 'flac'],
};

function getFileType(ext) {
  const lowerExt = ext.toLowerCase().replace(/^\./, '');
  for (const [type, exts] of Object.entries(FILE_TYPE_MAP)) {
    if (exts.includes(lowerExt)) return type;
  }
  return '其他';
}

// 上传文件到 S3
app.post('/api/upload', async (req, res) => {
  const { files } = req.body;
  const username = req.headers['x-username'];
  
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.json({ success: false, message: '请选择要上传的文件' });
  }

  try {
    // 获取用户信息（包括id和username）
    const [userRows] = await pool.query(
      'SELECT id, username, dept_id FROM person WHERE username = ? AND status = 1',
      [username]
    );
    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const uploaderId = userRows[0].id;
    const loginUsername = userRows[0].username;
    const deptId = userRows[0].dept_id;

    const uploadedFiles = [];
    
    for (const file of files) {
      const { filename, originalName, fileType, fileExt, description, fileSize, fileData } = file;
      
      // 生成 S3 key: 登录用户名/文件类型/上传文件名
      const s3Key = `${loginUsername}/${fileType}/${filename}`;
      
      // 上传文件到 S3
      const buffer = Buffer.from(fileData, 'base64');
      console.log(`开始上传文件到S3: ${s3Key}, 大小: ${buffer.length} bytes`);
      
      const putCommand = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: buffer,
        ContentType: getContentType(fileExt),
      });
      
      const s3Result = await s3Client.send(putCommand);
      console.log('S3上传成功:', s3Result.ETag);
      
      // 构建 S3 URL
      const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(loginUsername)}/${encodeURIComponent(fileType)}/${encodeURIComponent(filename)}`;
      
      // 获取当前时间作为上传时间
      const uploadTime = new Date();
      
      // 保存到数据库
      const [result] = await pool.query(
        `INSERT INTO files (filename, original_name, file_type, file_ext, description, file_size, s3_key, s3_url, uploader_id, dept_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [filename, originalName, fileType, fileExt, description || '', fileSize, s3Key, s3Url, uploaderId, deptId, uploadTime]
      );
      
      uploadedFiles.push({
        id: result.insertId,
        filename,
        fileType,
        s3Url,
        uploadTime: uploadTime,
        size: fileSize
      });
    }
    
    res.json({ success: true, message: '上传成功', files: uploadedFiles });
  } catch (err) {
    console.error('上传错误：', err);
    res.status(500).json({ success: false, message: '上传失败：' + err.message });
  }
});

function getContentType(ext) {
  const map = {
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// 递归获取部门层级路径（跳过1级部门-公司级）
async function getDeptHierarchy(deptId, pool) {
  const hierarchy = [];
  let currentId = deptId;
  
  while (currentId) {
    const [rows] = await pool.query(
      'SELECT id, name, parent_id, level FROM department WHERE id = ?',
      [currentId]
    );
    if (rows.length === 0) break;
    
    // 跳过1级部门（公司级）
    if (rows[0].level > 1) {
      hierarchy.unshift(rows[0].name);
    }
    
    currentId = rows[0].parent_id;
  }
  
  return hierarchy.join(' / ');
}

// 递归获取所有下级部门ID
async function getAllSubordinateDeptIds(deptId, pool) {
  const result = [deptId];
  
  async function findChildren(parentId) {
    const [rows] = await pool.query(
      'SELECT id FROM department WHERE parent_id = ?',
      [parentId]
    );
    
    for (const row of rows) {
      result.push(row.id);
      await findChildren(row.id);
    }
  }
  
  await findChildren(deptId);
  return result;
}

// 获取文件列表（带权限控制和搜索）
app.get('/api/files', async (req, res) => {
  const { 
    type, 
    page = 1, 
    pageSize = 20,
    keyword,
    uploader,
    dept,
    startDate,
    endDate
  } = req.query;
  
  const username = req.headers['x-username'];
  
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  const offset = (page - 1) * pageSize;
  
  try {
    // 获取当前用户信息（包括class和dept_id）
    const [userRows] = await pool.query(
      'SELECT id, class, dept_id, real_name FROM person WHERE username = ? AND status = 1',
      [username]
    );
    
    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    
    const userClass = userRows[0].class;
    const userDeptId = userRows[0].dept_id;
    const userId = userRows[0].id;
    
    let whereClause = 'WHERE f.status = 1';
    const params = [];
    
    // 文件类型筛选
    if (type && type !== '全部') {
      whereClause += ' AND f.file_type = ?';
      params.push(type);
    }
    
    // 搜索条件：文件名/描述模糊搜索
    if (keyword && keyword.trim()) {
      whereClause += ' AND (f.filename LIKE ? OR f.description LIKE ?)';
      const likeKeyword = `%${keyword.trim()}%`;
      params.push(likeKeyword, likeKeyword);
    }
    
    // 搜索条件：上传人精准匹配
    if (uploader && uploader.trim()) {
      whereClause += ' AND p.real_name = ?';
      params.push(uploader.trim());
    }
    
    // 搜索条件：部门精准匹配
    if (dept && dept.trim()) {
      whereClause += ' AND d.name = ?';
      params.push(dept.trim());
    }
    
    // 搜索条件：时间范围
    if (startDate) {
      whereClause += ' AND f.created_at >= ?';
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      whereClause += ' AND f.created_at <= ?';
      params.push(`${endDate} 23:59:59`);
    }
    
    // 权限控制
    let uploaderFilter = '';
    
    if (userClass === 0) {
      // class = 0（系统管理员）：查看全部，不添加限制
    } else if (userClass === 1) {
      // class = 1：查看class >= 1的所有人员上传的文件（即排除class=0的系统管理员）
      const [allowedRows] = await pool.query(
        'SELECT id FROM person WHERE class >= 1 AND status = 1',
      );
      const allowedUploaderIds = allowedRows.map(r => r.id);
      
      if (allowedUploaderIds.length === 0) {
        uploaderFilter = ' AND f.uploader_id = ?';
        params.push(userId);
      } else {
        uploaderFilter = ` AND f.uploader_id IN (${allowedUploaderIds.join(',')})`;
      }
    } else {
      // class > 1：查询自己部门及所有下级部门中，class > 当前用户class的人员
      const allDeptIds = await getAllSubordinateDeptIds(userDeptId, pool);
      
      const [subordinateRows] = await pool.query(
        `SELECT id FROM person WHERE dept_id IN (${allDeptIds.join(',')}) AND class > ? AND status = 1`,
        [userClass]
      );
      const allowedUploaderIds = subordinateRows.map(r => r.id);
      
      if (allowedUploaderIds.length === 0) {
        // 没有下级人员，只能看自己
        uploaderFilter = ' AND f.uploader_id = ?';
        params.push(userId);
      } else {
        // 包含自己和下级人员
        allowedUploaderIds.push(userId);
        uploaderFilter = ` AND f.uploader_id IN (${allowedUploaderIds.join(',')})`;
      }
    }
    
    whereClause += uploaderFilter;
    
    // 获取总数
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM files f 
       LEFT JOIN person p ON f.uploader_id = p.id
       LEFT JOIN department d ON f.dept_id = d.id
       ${whereClause}`,
      params
    );
    const total = countRows[0].total;
    
    // 获取文件列表
    const [rows] = await pool.query(
      `SELECT f.id, f.filename, f.original_name, f.file_type, f.file_ext, f.description, 
              f.file_size, f.s3_url, f.created_at, f.updated_at, 
              f.uploader_id, f.dept_id,
              p.real_name as uploader_name, d.name as dept_name
       FROM files f
       LEFT JOIN person p ON f.uploader_id = p.id
       LEFT JOIN department d ON f.dept_id = d.id
       ${whereClause}
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), parseInt(offset)]
    );
    
    // 处理部门层级和格式化
    for (const row of rows) {
      // 格式化文件大小
      row.file_size_formatted = formatFileSize(row.file_size);
      
      // 获取部门层级路径（从files.dept_id获取文件上传时的部门）
      if (row.dept_id) {
        row.dept_hierarchy = await getDeptHierarchy(row.dept_id, pool);
      } else {
        row.dept_hierarchy = '-';
      }
    }
    
    res.json({ 
      success: true, 
      files: rows, 
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (err) {
    console.error('获取文件列表错误：', err);
    res.status(500).json({ success: false, message: '获取文件列表失败' });
  }
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 修改文件信息
app.put('/api/files/:id', async (req, res) => {
  const { id } = req.params;
  const { filename, description, file_type } = req.body;
  const username = req.headers['x-username'];
  
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  try {
    // 检查权限
    const [userRows] = await pool.query(
      'SELECT id, class FROM person WHERE username = ? AND status = 1',
      [username]
    );
    
    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    
    const userId = userRows[0].id;
    const userClass = userRows[0].class;
    
    // 获取文件信息
    const [fileRows] = await pool.query(
      'SELECT uploader_id FROM files WHERE id = ? AND status = 1',
      [id]
    );
    
    if (fileRows.length === 0) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 权限检查：只能修改自己的文件，或class 0/1可以修改全部
    if (userClass > 1 && fileRows[0].uploader_id !== userId) {
      return res.status(403).json({ success: false, message: '无权修改此文件' });
    }
    
    // 更新文件信息
    await pool.query(
      'UPDATE files SET filename = ?, description = ?, file_type = ? WHERE id = ?',
      [filename, description, file_type, id]
    );
    
    res.json({ success: true, message: '修改成功' });
  } catch (err) {
    console.error('修改文件错误：', err);
    res.status(500).json({ success: false, message: '修改失败' });
  }
});

// 删除文件（包括S3）
app.delete('/api/files/:id', async (req, res) => {
  const { id } = req.params;
  const username = req.headers['x-username'];
  
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  try {
    // 检查权限
    const [userRows] = await pool.query(
      'SELECT id, class FROM person WHERE username = ? AND status = 1',
      [username]
    );
    
    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    
    const userId = userRows[0].id;
    const userClass = userRows[0].class;
    
    // 获取文件信息
    const [fileRows] = await pool.query(
      'SELECT uploader_id, s3_key FROM files WHERE id = ? AND status = 1',
      [id]
    );
    
    if (fileRows.length === 0) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    // 权限检查：只能删除自己的文件，或class 0/1可以删除全部
    if (userClass > 1 && fileRows[0].uploader_id !== userId) {
      return res.status(403).json({ success: false, message: '无权删除此文件' });
    }
    
    const s3Key = fileRows[0].s3_key;
    
    // 从S3删除文件
    try {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
      });
      await s3Client.send(deleteCommand);
      console.log('S3文件删除成功:', s3Key);
    } catch (s3Err) {
      console.error('S3删除失败:', s3Err.message);
      // S3删除失败不影响数据库删除，继续执行
    }
    
    // 软删除数据库记录
    await pool.query('UPDATE files SET status = 0 WHERE id = ?', [id]);
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除文件错误：', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
});
