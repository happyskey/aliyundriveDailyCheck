/*
cron "0 9 * * *" autoSignin.js, tag=阿里云盘签到
*/

const axios = require('axios')
const { initInstance, getEnv, updateCkEnv } = require('./qlApi.js')
const notify = require('./sendNotify')

const updateAccesssTokenURL = 'https://auth.aliyundrive.com/v2/account/token'
const signinURL = 'https://member.aliyundrive.com/v1/activity/sign_in_list'
const clearURL = 'https://api.aliyundrive.com/v2/recyclebin/clear'
const getdeviceidurl = 'https://api.aliyundrive.com/adrive/v2/user/get'
const getfilelistURL = 'https://api.aliyundrive.com/adrive/v3/file/list'
const batchURL = 'https://api.aliyundrive.com/v2/batch'

// 使用 refresh_token 更新 access_token
function updateAccesssToken(queryBody, remarks) {
  const errorMessage = [remarks, '更新 access_token 失败']
  return axios(updateAccesssTokenURL, {
    method: 'POST',
    data: queryBody,
    headers: { 'Content-Type': 'application/json' }
  })
    .then(d => d.data)
    .then(d => {
      const { code, message, nick_name, refresh_token, access_token } = d
      if (code) {
        if (
          code === 'RefreshTokenExpired' ||
          code === 'InvalidParameter.RefreshToken'
        )
          errorMessage.push('refresh_token 已过期或无效')
        else errorMessage.push(message)
        return Promise.reject(errorMessage.join(', '))
      }
      return { nick_name, refresh_token, access_token }
    })
    .catch(e => {
      errorMessage.push(e.message)
      return Promise.reject(errorMessage.join(', '))
    })
}

//签到
function sign_in(queryBody, access_token, remarks) {
  const sendMessage = [remarks]
  return axios(signinURL, {
    method: 'POST',
    data: queryBody,
    headers: {
      Authorization: 'Bearer ' + access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(json => {
      if (!json.success) {
        sendMessage.push('签到失败')
        return Promise.reject(sendMessage.join(', '))
      }

      sendMessage.push('签到成功')

      const { signInLogs, signInCount } = json.result
      const currentSignInfo = signInLogs[signInCount - 1] // 当天签到信息

      sendMessage.push(`本月累计签到 ${signInCount} 天`)

      // 当天签到是否有奖励
      if (
        currentSignInfo.reward &&
        (currentSignInfo.reward.name || currentSignInfo.reward.description)
      )
        sendMessage.push(
          `本次签到获得${currentSignInfo.reward.name || ''}${currentSignInfo.reward.description || ''
          }`
        )

      return sendMessage.join(', ')
    })
    .catch(e => {
      sendMessage.push('签到失败')
      sendMessage.push(e.message)
      return Promise.reject(sendMessage.join(', '))
    })
}

//获取设备id
function getdeviceid(access_token) {
  return axios(getdeviceidurl, {
    method: 'POST',
    data: '{}',
    headers: {
      authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(d => {
      const { default_drive_id } = d
      return { default_drive_id }
    })
    .catch(e => {
      errorMessage.push(e.message)
      return Promise.reject(errorMessage.join(', '))
    })
}

//获取临时转存文件内容
function getfilelist(default_drive_id, temp_transfer_folder_id, access_token) {
  return axios(getfilelistURL, {
    method: 'POST',
    data: '{"drive_id":"' + default_drive_id + '","parent_file_id":"' + temp_transfer_folder_id + '","limit":200}',
    headers: {
      authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(d => {
      const { items } = d
      return items.map(item => item.file_id);
    })
    .catch(e => {
      errorMessage.push(e.message)
      return Promise.reject(errorMessage.join(', '))
    })
}

//删除文件到回收站
function batch(default_drive_id, file_ids, access_token) {
  const requests = file_ids.map(fileId => ({
    body: {
      drive_id: default_drive_id,
      file_id: fileId
    },
    id: fileId,
    method: "POST",
    url: "/recyclebin/trash"
  }));

  const result = {
    requests: requests,
    resource: "file"
  };
  return axios(batchURL, {
    method: 'POST',
    data: JSON.stringify(result),
    headers: {
      authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(d => { })
    .catch(e => {
      errorMessage.push(e.message)
      return Promise.reject(errorMessage.join(', '))
    })
}

//清空回收站
function clearfiles(default_drive_id, access_token, remarks) {
  const sendMessage = [remarks]
  return axios(clearURL, {
    method: 'POST',
    data: '{"drive_id":"' + default_drive_id + '"}',
    headers: {
      authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(json => {
      if (!json.domain_id) {
        sendMessage.push('清空转存目录失败')
        return Promise.reject(sendMessage.join(', '))
      }
      else {
        sendMessage.push('清空转存目录成功')
        return Promise.reject(sendMessage.join(', '))
      }
    })
    .catch(e => {
      sendMessage.push(e.message)
      return Promise.reject(sendMessage.join(', '))
    })
}

// 获取环境变量
async function getRefreshToken() {
  let instance = null
  try {
    instance = await initInstance()
  } catch (e) { }

  let refreshToken = process.env.refreshToken || []
  try {
    if (instance) refreshToken = await getEnv(instance, 'refreshToken')
  } catch (e) { }

  let refreshTokenArray = []

  if (Array.isArray(refreshToken)) refreshTokenArray = refreshToken
  else if (refreshToken.indexOf('&') > -1)
    refreshTokenArray = refreshToken.split('&')
  else if (refreshToken.indexOf('\n') > -1)
    refreshTokenArray = refreshToken.split('\n')
  else refreshTokenArray = [refreshToken]

  if (!refreshTokenArray.length) {
    console.log('未获取到refreshToken, 程序终止')
    process.exit(1)
  }


  let temp_transfer_folder_id = process.env.temp_transfer_folder_id || []
  try {
    if (instance) temp_transfer_folder_id = await getEnv(instance, 'temp_transfer_folder_id')
  } catch (e) { }

  let temp_transfer_folder_idArray = []

  if (Array.isArray(temp_transfer_folder_id)) temp_transfer_folder_idArray = temp_transfer_folder_id
  else if (temp_transfer_folder_id.indexOf('&') > -1)
    temp_transfer_folder_idArray = temp_transfer_folder_id.split('&')
  else if (temp_transfer_folder_id.indexOf('\n') > -1)
    temp_transfer_folder_idArray = temp_transfer_folder_id.split('\n')
  else temp_transfer_folder_idArray = [temp_transfer_folder_id]

  // if (!temp_transfer_folder_idArray.length) {
  //   console.log('未获取到temp_transfer_folder_id, 程序终止')
  //   process.exit(1)
  // }

  return {
    instance,
    refreshTokenArray,
    temp_transfer_folder_idArray
  }
}

!(async () => {
  const { instance, refreshTokenArray, temp_transfer_folder_idArray } = await getRefreshToken()

  const message = []
  let index = 1
  for await (refreshToken of refreshTokenArray) {
    let remarks = refreshToken.remarks || `账号${index}`
    let temp_transfer_folder_id = temp_transfer_folder_idArray[index - 1] || 'none'
    if (temp_transfer_folder_id.value) {
      temp_transfer_folder_id = temp_transfer_folder_id.value
    }
    const queryBody = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken.value || refreshToken
    }
    try {
      const { nick_name, refresh_token, access_token } =
        await updateAccesssToken(queryBody, remarks)

      if (nick_name && nick_name !== remarks)
        remarks = `${nick_name}(${remarks})`

      // 更新环境变量
      if (instance) {
        let params = {
          name: refreshToken.name,
          value: refresh_token,
          remarks: refreshToken.remarks || nick_name // 优先存储原有备注信息
        }
        // 新版青龙api
        if (refreshToken.id) {
          params.id = refreshToken.id
        }
        // 旧版青龙api
        if (refreshToken._id) {
          params._id = refreshToken._id
        }
        await updateCkEnv(instance, params)
      }

      const sendMessage = await sign_in(queryBody, access_token, remarks)
      console.log(sendMessage)
      console.log('\n')
      message.push(sendMessage)
      if (temp_transfer_folder_id && temp_transfer_folder_id !== 'none') {
        const { default_drive_id } =
          await getdeviceid(access_token)
        const filelist =
          await getfilelist(default_drive_id, temp_transfer_folder_id, access_token)
        await batch(default_drive_id, filelist, access_token)
        sendMessage = await clearfiles(default_drive_id, access_token, remarks)
        console.log(sendMessage)
        console.log('\n')
        message.push(sendMessage)
      }
    } catch (e) {
      console.log(e)
      console.log('\n')
      message.push(e)
    }
    index++
  }
  await notify.sendNotify(`阿里云盘签到`, message.join('\n'))
})()
