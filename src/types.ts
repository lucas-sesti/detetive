/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum GamePhase {
  LOBBY = 'lobby',
  INTRO = 'intro',
  TRANSITION = 'transition',
  REVEAL = 'reveal',
  GOSSIP = 'gossip',
  GOSSIP_2 = 'gossip_2',
  INTERROGATION = 'interrogation',
  VOTING = 'voting',
  RESULT = 'result',
  GAME_OVER = 'game_over'
}

export enum Role {
  KILLER = 'killer',
  INNOCENT = 'innocent'
}

export enum Item {
  KNIFE = 'Faca',
  GLASSES = 'Óculos',
  DRINK = 'Bebida',
  WATCH = 'Relógio',
  RING = 'Anel',
  LETTER = 'Carta',
  PHOTOGRAPH = 'Fotografia',
  KEY = 'Chave',
  POCKET_WATCH = 'Relógio de Bolso',
  CIGARETTE_CASE = 'Porta-Cigarros'
}

export enum SecretActionType {
  SHUFFLE = 'Embaralhar',
  STEAL = 'Roubar',
  SNOOP = 'Espiar',
  SWAP = 'Trocar',
  ALIBI = 'Álibi',
  PLANT_EVIDENCE = 'Incriminar',
  SKIP = 'Pular'
}

export interface Player {
  id: string;
  nickname: string;
  avatar: string;
  isHost: boolean;
  role?: Role;
  item?: Item;
  hasKnife?: boolean;
  itemVisible?: boolean;
  roleRevealed?: boolean;
  votedFor?: string;
  hasLockedVote?: boolean;
  hasGossipVoted?: boolean;
  isAlive: boolean;
  canPerformSecretAction: boolean;
  gossipVote?: string; 
  isIncriminated?: boolean;
  usedPlantEvidence?: boolean;
  assignedSecretAction?: SecretActionType;
  logs: string[];
  isReadyToSkip?: boolean;
  itemExposed?: boolean;
  notification?: {
    message: string;
    type: 'stolen' | 'swapped' | 'incriminated';
  } | null;
}

export interface GossipResult {
  question: string;
  mostVotedId: string | null;
  mostVotedName: string;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  players: Player[];
  currentQuestion?: string;
  questionIndex: number;
  timer: number;
  winner?: Role;
  roundCount: number;
  lastAction?: {
    type: SecretActionType;
    actor: string;
    details: string;
  };
  eventMessage?: string;
  activePopup?: {
    message: string;
    type: "event" | "action";
  } | null;
  isSecretActionWindow?: boolean;
  isInterrogationQuestionWindow?: boolean;
  gossipResults: GossipResult[];
  interrogationIndex: number;
  gossipQuestions?: string[];
  interrogationQuestion?: string;
  hasTriggeredRandomEvent?: boolean;
}

export interface SecretActionPayload {
  type: SecretActionType;
  targetId1: string;
  targetId2?: string;
}
