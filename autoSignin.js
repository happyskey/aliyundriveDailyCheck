/*
cron "0 9 * * *" autoSignin.js, tag=阿里云盘签到
*/

const axios = require('axios')
const { initInstance, getEnv, updateCkEnv } = require('./qlApi.js')
const notify = require('./sendNotify')

const updateAccesssTokenURL = 'https://auth.aliyundrive.com/v2/account/token'
const signinURL =
  'https://member.aliyundrive.com/v2/activity/sign_in_list?_rx-s=mobile'//签到列表
const rewardURL =
  'https://member.aliyundrive.com/v1/activity/sign_in_reward?_rx-s=mobile'//每日签到领取 
const taskrewardURL =
  'https://member.aliyundrive.com/v2/activity/sign_in_task_reward?_rx-s=mobile'//每日任务领取，任务未完成会失败  
const getdeviceidurl = 'https://user.aliyundrive.com/v2/user/get'
const getfilelistURL = 'https://api.aliyundrive.com/adrive/v3/file/list'
const batchURL = 'https://api.aliyundrive.com/v2/batch'
const restarttime = 10
// 使用 refresh_token 更新 access_token
function updateAccesssToken(queryBody, remarks, time) {
  const _times = time | 0
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
        if(_times<restarttime){
          return updateAccesssToken(queryBody, remarks,_times+1)
        }
        else{
          return Promise.reject(errorMessage.join(', '))
        }
      }
      return { nick_name, refresh_token, access_token }
    })
    .catch(e => {
      errorMessage.push(e.message)
        if(_times<restarttime){
          return updateAccesssToken(queryBody, remarks,_times+1)
        }
        else{
          return Promise.reject(errorMessage.join(', '))
        }
    })
}

//签到列表
function sign_in(access_token, remarks, times) {
  const _times = times | 0
  const sendMessage = [remarks]
  return axios(signinURL, {
    method: 'POST',
    data: {
      isReward: false
    },
    headers: {
      Authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(async json => {
      if (!json.success) {
        sendMessage.push('签到失败', json.message)
        if(_times<restarttime){
          return sign_in(access_token, remarks, _times+1)
        }
        else{
          return Promise.reject(sendMessage.join(', '))
        }
      }

      sendMessage.push('签到成功')

      const { signInInfos, signInCount } = json.result
      const currentSignInfo = signInLogs[signInCount - 1] // 当天签到信息

      sendMessage.push(`本月累计签到 ${signInCount} 天`)

      // 未领取奖励列表
      const rewards = signInInfos.filter(
        v => v.status === 'normal' && v.rewards.filter(k => (k.type==='dailySignIn'||k.type==='dailySignIn') && k.status!=='verification')
      )

      if (rewards.length) {
        for await (reward of rewards) {
          const signInDay = reward.day
          try {            
              let rewardInfo = await getReward(access_token, signInDay,rewardURL)
              sendMessage.push(
                `第${signInDay}天奖励领取成功: 获得${rewardInfo.name || ''}${
                  rewardInfo.description || ''
                }`
              )
              if(reward[1] && reward[1].type === 'dailyTask'){
              rewardInfo = await getReward(access_token, signInDay,taskrewardURL)
              if(rewardInfo.name ||''){
                sendMessage.push(
                  `、${rewardInfo.name || ''}${
                    rewardInfo.description || ''
                  }`
                )
              }
              else{
                sendMessage.push(
                  `、${
                    reward.remind || ''
                  }`
                )
              }
            }
          } catch (e) {
            sendMessage.push(`第${signInDay}天奖励领取失败:`, e)
          }
        }
      } else if (currentSignInfo.isReward) {
        sendMessage.push(
          `今日签到获得${currentSignInfo.reward.name || ''}${
            currentSignInfo.reward.description || ''
          }`
        )
      }

      return sendMessage.join(', ')
    })
    .catch(e => {
      sendMessage.push('签到失败')
      sendMessage.push(e.message)
        if(_times<restarttime){
          return sign_in(access_token, remarks, _times+1)
        }
        else{
          return Promise.reject(sendMessage.join(', '))
        }
    })
}

// 领取奖励
function getReward(access_token, signInDay,rewardURL_) {
  const _times = times | 0
  return axios(rewardURL_, {
    method: 'POST',
    data: { signInDay },
    headers: {
      authorization: access_token,
      'Content-Type': 'application/json'
    }
  })
    .then(d => d.data)
    .then(json => {
      if (!json.success) {
        if(_times<restarttime){
          return getReward(access_token, signInDay, _times+1)
        }
        else{
          return Promise.reject(json.message)
        }
      }

      return json.result || json
    })
}

//获取设备id
function getdeviceid(access_token, time) {
  const _times = time | 0
  const errorMessage = [ '获取设备id失败']
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
        const { default_drive_id, resource_drive_id } = d
        return { default_drive_id, resource_drive_id }
    })
    .catch(e => {
      errorMessage.push(e.message)
        if(_times<restarttime){
          return getdeviceid(access_token,_times+1)
        }
        else{
          return Promise.reject(errorMessage.join(', '))
        }
    })
}

//获取临时转存文件内容
function getfilelist(default_drive_id, temp_transfer_folder_id, access_token, time) {
  const _times = time | 0
  const errorMessage = [ '获取临时转存文件内容失败']
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
        if(_times<restarttime){
          return getfilelist(default_drive_id, temp_transfer_folder_id, access_token, _times+1)
        }
        else{
           return Promise.reject(errorMessage.join(', '))
        }
    })
}

//直接删除文件
function batch(default_drive_id, file_ids, access_token, time) {
  const _times = time | 0
  const errorMessage = [ '直接删除文件失败']
  const requests = file_ids.map(fileId => ({
    body: {
      drive_id: default_drive_id,
      file_id: fileId
    },
    id: fileId,
    method: "POST",
    url: "/file/delete"
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
        if(_times<restarttime){
          return batch(default_drive_id, file_ids, access_token, _times+1)
        }
        else{
           return Promise.reject(errorMessage.join(', '))
        }
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
    temp_transfer_folder_id = temp_transfer_folder_id.value || temp_transfer_folder_id
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

      const sendMessage = await sign_in(access_token, remarks)
      console.log(sendMessage)
      console.log('\n')
      message.push(sendMessage)
      if (temp_transfer_folder_id && temp_transfer_folder_id !== 'none') {
        const { default_drive_id, resource_drive_id } =
          await getdeviceid(access_token)
        const drive_id = resource_drive_id?resource_drive_id:default_drive_id
        let filelist = []
        filelist = await getfilelist(drive_id, temp_transfer_folder_id, access_token)
        let filecount = filelist.length
        await batch(drive_id, filelist, access_token)
        while (filelist.length == 200) {
          filelist = await getfilelist(drive_id, temp_transfer_folder_id, access_token)
          filecount += filelist.length
          await batch(drive_id, filelist, access_token)
        }
        console.log(`已删除转存文件${filecount}个`)
        message.push(`已删除转存文件${filecount}个`)
        console.log('\n')
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
