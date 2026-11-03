const security = require('../security/cypher')

const utils = {

    jsonMount:(
        boll,data,msg
    )=>{
            return {"payload":security.jwtencript({boleano: boll, obj: data, mensagem: msg})}
    },

    errorHandle:(
        error, rota
    ) =>{
        console.log(`Erro na rota ${rota}`)
        console.log(error)
        return utils.jsonMount(false, {}, 'Tente novamente mais tarde!')
    },

    
}

module.exports = utils