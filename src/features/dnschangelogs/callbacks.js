const { deleteDnsLogsProcessMessages, createDnsLogsReply, trackDnsLogsMessage } = require('./utils');
const { getDnsLogs, getAvailableLogDates } = require('../../utils/dnsLogger');

// 每页显示的日志条数
const LOGS_PER_PAGE = 5;

// 每页显示的日期数量
const DATES_PER_PAGE = 5;

// 格式化操作类型
function formatOperation(operation) {
  const opMap = {
    'create': '创建',
    'update': '更新',
    'delete': '删除'
  };
  return opMap[operation] || operation;
}

// 格式化日志条目
function formatLogEntry(log) {
  let message = `⏰ ${log.timestamp}\n`;
  
  // 根据操作类型使用不同的emoji
  let operationEmoji = '🔄';
  if (log.operation === 'create') {
    operationEmoji = '➕';
  } else if (log.operation === 'delete') {
    operationEmoji = '🗑️';
  } else if (log.operation === 'update') {
    operationEmoji = '✏️';
  }
  
  message += `${operationEmoji} 操作: ${formatOperation(log.operation)}\n`;
  message += `🌐 域名: ${log.domain}\n`;
  
  // 根据记录类型使用不同的emoji
  let typeEmoji = '📝';
  if (log.recordType === 'A') {
    typeEmoji = '4️⃣';  // IPv4
  } else if (log.recordType === 'AAAA') {
    typeEmoji = '6️⃣';  // IPv6
  }
  message += `${typeEmoji} 记录类型: ${log.recordType || 'N/A'}\n`;
  
  message += `🔢 IP地址: ${log.ipAddress || 'N/A'}\n`;
  message += `☁️ CF代理: ${log.proxied ? '✅ 是' : '❌ 否'}\n`;

  // 更新操作展示旧值
  if (log.operation === 'update') {
    message += `\n📜 变更详情:\n`;
    
    if (log.oldIpAddress && log.oldIpAddress !== log.ipAddress) {
      message += `  🔢 IP: ${log.oldIpAddress} ➡️ ${log.ipAddress}\n`;
    }
    
    if (log.oldProxied !== undefined && log.oldProxied !== log.proxied) {
      const oldProxyStatus = log.oldProxied ? '✅ 是' : '❌ 否';
      const newProxyStatus = log.proxied ? '✅ 是' : '❌ 否';
      message += `  ☁️ 代理: ${oldProxyStatus} ➡️ ${newProxyStatus}\n`;
    }
  }
  
  return message;
}

function setupCallbacks(bot) {
  // 处理查看日志回调
  bot.action(/view_logs:(.+):(\d+)/, async (ctx) => {
    trackDnsLogsMessage(ctx);
    try {
      const date = ctx.match[1];
      const page = parseInt(ctx.match[2], 10);

      // 获取指定日期的日志
      const logs = getDnsLogs(date);

      if (logs.length === 0) {
        await ctx.editMessageText(`${date} 没有DNS操作日志记录。`);
        await ctx.answerCbQuery('没有找到日志记录');
        return;
      }

      // 计算分页信息
      const totalPages = Math.ceil(logs.length / LOGS_PER_PAGE);
      const startIdx = page * LOGS_PER_PAGE;
      const endIdx = Math.min(startIdx + LOGS_PER_PAGE, logs.length);
      const pageTitle = `${date} DNS操作日志 (第${startIdx + 1}条-第${endIdx}条/共${logs.length}条记录)`;

      // 获取当前页的日志
      const pageItems = logs.slice(startIdx, endIdx);

      // 格式化日志内容
      let message = `📋 ${pageTitle}\n\n`;
      pageItems.forEach((log, idx) => {
        message += `${formatLogEntry(log)}\n`;
        if (idx < pageItems.length - 1) {
          message += '➖➖➖➖➖➖➖➖➖➖\n\n';
        }
      });

      // 创建分页按钮
      const navigationButtons = [];

      // 上一页按钮
      if (page > 0) {
        navigationButtons.push({ text: '⬅️ 上一页', callback_data: `view_logs:${date}:${page - 1}` });
      }

      // 页码信息
      navigationButtons.push({
        text: `${page + 1}/${totalPages}`,
        callback_data: 'logs_page_info'
      });

      // 下一页按钮
      if (page < totalPages - 1) {
        navigationButtons.push({ text: '下一页 ➡️', callback_data: `view_logs:${date}:${page + 1}` });
      }

      // 返回和取消按钮
      const actionButtons = [
        { text: '返回日期列表', callback_data: 'back_to_dates' },
        { text: '完成查询', callback_data: 'cancel_dnschangelogs' }
      ];

      // 合并所有按钮
      const inlineKeyboard = [navigationButtons, actionButtons];

      await createDnsLogsReply(ctx)(message, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      
      // 添加这一行来停止加载状态
      await ctx.answerCbQuery(`已加载${date}的日志`);

    } catch (error) {
      console.error('处理查看日志回调失败:', error);
      await ctx.reply('获取DNS日志失败，请稍后再试。');
      await ctx.answerCbQuery('加载日志失败');
    }
  });

  // 新增：处理日期列表分页
  bot.action(/dates_page:(\d+)/, async (ctx) => {
    trackDnsLogsMessage(ctx);
    try {
      const page = parseInt(ctx.match[1], 10);
      
      // 获取可用的日志日期
      const dates = getAvailableLogDates();
      
      if (dates.length === 0) {
        await ctx.editMessageText('没有找到任何DNS变更日志。');
        return;
      }

      // 计算分页信息
      const totalPages = Math.ceil(dates.length / DATES_PER_PAGE);
      const startIdx = page * DATES_PER_PAGE;
      const endIdx = Math.min(startIdx + DATES_PER_PAGE, dates.length);
      const pageDates = dates.slice(startIdx, endIdx);

      // 为当前页的每个日期创建按钮
      const dateButtons = pageDates.map(date => {
        return [{ text: date, callback_data: `view_logs:${date}:0` }];
      });

      // 构建分页导航按钮
      const navigationButtons = [];

      // 上一页按钮
      if (page > 0) {
        navigationButtons.push({ text: '⬅️ 上一页', callback_data: `dates_page:${page - 1}` });
      }

      // 页码信息
      navigationButtons.push({
        text: `${page + 1}/${totalPages}`,
        callback_data: 'dates_page_info'
      });

      // 下一页按钮
      if (page < totalPages - 1) {
        navigationButtons.push({ text: '下一页 ➡️', callback_data: `dates_page:${page + 1}` });
      }

      // 取消按钮
      const actionButtons = [{ text: '取消', callback_data: 'cancel_dnschangelogs' }];

      // 合并所有按钮
      const inlineKeyboard = [...dateButtons, navigationButtons, actionButtons];

      const messageText = `请选择要查看的日志日期 (第${startIdx + 1}-${endIdx}条/共${dates.length}条)：`;

      await ctx.editMessageText(messageText, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      
      await ctx.answerCbQuery(`切换到第${page + 1}页`);

    } catch (error) {
      console.error('处理日期分页失败:', error);
      await ctx.answerCbQuery('切换页面失败');
    }
  });

  // 新增：处理日期列表页码信息回调
  bot.action('dates_page_info', async (ctx) => {
    await ctx.answerCbQuery('日期列表页码信息');
  });

  // 处理页码信息回调
  bot.action('logs_page_info', async (ctx) => {
    await ctx.answerCbQuery('当前页码信息');
  });

  // 修改：处理返回日期列表回调
  bot.action('back_to_dates', async (ctx) => {
    trackDnsLogsMessage(ctx);
    
    try {
      // 获取可用的日志日期
      const dates = getAvailableLogDates();

      if (dates.length === 0) {
        await ctx.editMessageText('没有找到任何DNS变更日志。');
        return;
      }

      // 显示第一页
      const page = 0;
      const totalPages = Math.ceil(dates.length / DATES_PER_PAGE);
      const startIdx = page * DATES_PER_PAGE;
      const endIdx = Math.min(startIdx + DATES_PER_PAGE, dates.length);
      const pageDates = dates.slice(startIdx, endIdx);

      // 为当前页的每个日期创建按钮
      const dateButtons = pageDates.map(date => {
        return [{ text: date, callback_data: `view_logs:${date}:0` }];
      });

      // 构建分页导航按钮
      const navigationButtons = [];
      if (totalPages > 1) {
        navigationButtons.push({
          text: `1/${totalPages}`,
          callback_data: 'dates_page_info'
        });
        navigationButtons.push({ text: '下一页 ➡️', callback_data: `dates_page:1` });
      }

      // 添加取消按钮
      const actionButtons = [{ text: '取消', callback_data: 'cancel_dnschangelogs' }];

      // 合并所有按钮
      const inlineKeyboard = [...dateButtons];
      if (navigationButtons.length > 0) {
        inlineKeyboard.push(navigationButtons);
      }
      inlineKeyboard.push(actionButtons);

      const messageText = totalPages > 1 
        ? `请选择要查看的日志日期 (第${startIdx + 1}-${endIdx}条/共${dates.length}条)：`
        : '请选择要查看的日志日期：';

      await ctx.editMessageText(messageText, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
      
      await ctx.answerCbQuery('返回日期列表');
      
    } catch (error) {
      console.error('返回日期列表失败:', error);
      await ctx.answerCbQuery('返回失败');
    }
  });

  // 处理取消回调
  bot.action('cancel_dnschangelogs', async (ctx) => {
    const currentMessageId = ctx.callbackQuery.message.message_id;

    // 先编辑当前消息
    await ctx.editMessageText('已关闭DNS变更日志查询。');

    // 删除其他相关消息，但排除当前消息
    await deleteDnsLogsProcessMessages(ctx, currentMessageId);
  });
}

module.exports = { setupCallbacks };  