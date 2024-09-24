// create metadata for all the available functions to pass to completions API
const tools = [
  {
    type: 'function',
    function: {
      name: 'checkInventory',
      say: 'Ļaujiet man pārbaudīt mūsu krājumus tieši tagad.',
      description: 'Pārbaudīt AirPods, AirPods Pro vai AirPods Max krājumus.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            'enum': ['airpods', 'airpods pro', 'airpods max'],
            description: 'AirPods modelis, vai nu AirPods, AirPods Pro, vai AirPods Max',
          },
        },
        required: ['model'],
      },
      returns: {
        type: 'object',
        properties: {
          stock: {
            type: 'integer',
            description: 'Vesels skaitlis, kas norāda, cik daudz no šī modeļa pašlaik ir krājumā.'
          }
        }
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkPrice',
      say: 'Ļaujiet man pārbaudīt cenu, vienu brīdi.',
      description: 'Pārbaudīt dotā AirPods, AirPods Pro vai AirPods Max modeļa cenu.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            'enum': ['airpods', 'airpods pro', 'airpods max'],
            description: 'AirPods modelis, vai nu AirPods, AirPods Pro, vai AirPods Max',
          },
        },
        required: ['model'],
      },
      returns: {
        type: 'object',
        properties: {
          price: {
            type: 'integer',
            description: 'Modeļa cena'
          }
        }
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'placeOrder',
      say: 'Labi, es tikai reģistrēšu to mūsu sistēmā.',
      description: 'Veikt pasūtījumu AirPods komplektam.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            'enum': ['airpods', 'airpods pro'],
            description: 'AirPods modelis, vai nu parastais vai Pro',
          },
          quantity: {
            type: 'integer',
            description: 'AirPods skaits, ko viņi vēlas pasūtīt',
          },
        },
        required: ['type', 'quantity'],
      },
      returns: {
        type: 'object',
        properties: {
          price: {
            type: 'integer',
            description: 'Kopējā pasūtījuma cena, ieskaitot nodokli'
          },
          orderNumber: {
            type: 'integer',
            description: 'Pasūtījuma numurs, kas saistīts ar šo pasūtījumu'
          }
        }
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'transferCall',
      say: 'Vienu brīdi, kamēr es pārsūtīšu jūsu zvanu.',
      description: 'Pārsūta klientu pie dzīva aģenta, ja viņi pieprasa palīdzību no īsta cilvēka.',
      parameters: {
        type: 'object',
        properties: {
          callSid: {
            type: 'string',
            description: 'Unikāls identifikators aktīvajam tālruņa zvanam.',
          },
        },
        required: ['callSid'],
      },
      returns: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Vai klienta zvans tika veiksmīgi pārsūtīts vai ne'
          },
        }
      }
    },
  },
];

module.exports = tools;