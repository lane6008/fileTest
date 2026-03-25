USE db02;

-- =====================
-- 部门数据（四级结构）
-- =====================

-- level 1：公司
INSERT INTO department (id, name, level, parent_id, sort_order) VALUES
(1, '某某科技有限公司', 1, NULL, 0);

-- level 2：一级部门
INSERT INTO department (id, name, level, parent_id, sort_order) VALUES
(2, '市场部',  2, 1, 1),
(3, '设计部',  2, 1, 2),
(4, '技术部',  2, 1, 3),
(5, '行政部',  2, 1, 4);

-- level 3：二级部门
INSERT INTO department (id, name, level, parent_id, sort_order) VALUES
(6,  '华东市场组', 3, 2, 1),
(7,  '华北市场组', 3, 2, 2),
(8,  'UI设计组',   3, 3, 1),
(9,  '前端开发组', 3, 4, 1);

-- level 4：三级部门
INSERT INTO department (id, name, level, parent_id, sort_order) VALUES
(10, '上海小组', 4, 6, 1);

-- =====================
-- 人员数据
-- =====================
INSERT INTO person (username, password, real_name, class, job, dept_id, phone, email, status) VALUES
-- admin：系统管理员，class=0，挂靠公司顶层
('admin',    '1111',   '系统管理员', 0, '系统管理员',     1,  NULL,           'admin@company.com',    1),
-- 总经理，class=1
('zhangjian','1111',   '张建',       1, '总经理',         1,  '13800000001',  'zhangjian@company.com',1),
-- 一级部门经理，class=2
('lihua',    '1111',   '李华',       2, '市场部经理',     2,  '13800000002',  'lihua@company.com',    1),
('wangfang', '1111',   '王芳',       2, '设计部经理',     3,  '13800000003',  'wangfang@company.com', 1),
-- 二级部门主管，class=3
('zhangsan', '1111',   '张三',       3, '华东市场组主管', 6,  '13800000004',  NULL,                   1),
-- 普通员工，class=4
('lisi',     '1111',   '李四',       4, 'UI设计师',       8,  '13800000005',  'lisi@company.com',     1),
('wangwu',   '1111',   '王五',       4, '前端工程师',     9,  '13800000006',  'wangwu@company.com',   1);
