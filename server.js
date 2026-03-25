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
    // 获取用户信息
    const [userRows] = await pool.query(
      'SELECT id, dept_id FROM person WHERE username = ? AND status = 1',
      [username]
    );
    if (userRows.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    const uploaderId = userRows[0].id;
    const deptId = userRows[0].dept_id;

    const uploadedFiles = [];
    
    for (const file of files) {
      const { filename, originalName, fileType, fileExt, description, fileSize, fileData } = file;
      
      // 生成 S3 key
      const timestamp = Date.now();
      const s3Key = `uploads/${username}/${timestamp}_${filename}`;
      
      // 上传文件到 S3
      const buffer = Buffer.from(fileData, 'base64');
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Key,
          Body: buffer,
          ContentType: getContentType(fileExt),
        },
      });
      
      await upload.done();
      
      // 构建 S3 URL
      const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
      
      // 保存到数据库
      const [result] = await pool.query(
        `INSERT INTO files (filename, original_name, file_type, file_ext, description, file_size, s3_key, s3_url, uploader_id, dept_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [filename, originalName, fileType, fileExt, description || '', fileSize, s3Key, s3Url, uploaderId, deptId]
      );
      
      uploadedFiles.push({
        id: result.insertId,
        filename,
        fileType,
        s3Url
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

// 获取文件列表
app.get('/api/files', async (req, res) => {
  const { type, page = 1, pageSize = 20 } = req.query;
  const offset = (page - 1) * pageSize;
  
  try {
    let whereClause = 'WHERE f.status = 1';
    const params = [];
    
    if (type && type !== '全部') {
      whereClause += ' AND f.file_type = ?';
      params.push(type);
    }
    
    // 获取总数
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM files f ${whereClause}`,
      params
    );
    const total = countRows[0].total;
    
    // 获取文件列表
    const [rows] = await pool.query(
      `SELECT f.id, f.filename, f.original_name, f.file_type, f.file_ext, f.description, 
              f.file_size, f.s3_url, f.created_at, p.real_name as uploader_name, d.name as dept_name
       FROM files f
       LEFT JOIN person p ON f.uploader_id = p.id
       LEFT JOIN department d ON f.dept_id = d.id
       ${whereClause}
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), parseInt(offset)]
    );
    
    // 格式化文件大小
    rows.forEach(row => {
      row.file_size_formatted = formatFileSize(row.file_size);
    });
    
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

// 删除文件
app.delete('/api/files/:id', async (req, res) => {
  const { id } = req.params;
  const username = req.headers['x-username'];
  
  if (!username) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  try {
    await pool.query('UPDATE files SET status = 0 WHERE id = ?', [id]);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
});
